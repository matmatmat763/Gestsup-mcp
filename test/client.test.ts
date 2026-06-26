import { describe, it, expect } from "vitest";
import { GestsupClient } from "../src/gestsupClient.js";
import { GestsupError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const cfg: Config = {
  baseUrl: "https://gestsup.example",
  apiKey: "TESTKEY",
  authMode: "header",
  timeoutMs: 5000,
  allowWrites: true,
};

/** Construit un faux fetch renvoyant une réponse figée et capturant l'appel. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method?: string; headers?: Record<string, string> }[] = [];
  const impl = (async (url: URL | string, init?: RequestInit) => {
    calls.push({
      url: url.toString(),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
    });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("GestsupClient.createTicket", () => {
  it("renvoie l'id sur succès et envoie l'en-tête X-API-KEY", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      ticket_id: 123,
      ticket_url: "https://gestsup.example/index.php?page=ticket&id=123",
      message: "Ticket 123 created",
    });
    const client = new GestsupClient(cfg, impl);
    const r = await client.createTicket({ title: "T", description: "D" });
    expect(r.ticket_id).toBe("123");
    expect(calls[0].url).toBe("https://gestsup.example/api/v1/ticket/");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["X-API-KEY"]).toBe("TESTKEY");
  });

  it("lève une GestsupError sur 400", async () => {
    const { impl } = fakeFetch(400, { code: 1, type: "error", message: "Missing required ticket_title field" });
    const client = new GestsupClient(cfg, impl);
    await expect(client.createTicket({ title: "", description: "" })).rejects.toBeInstanceOf(GestsupError);
  });
});

describe("GestsupClient.getTicket", () => {
  it("mappe le 404 en erreur explicite", async () => {
    const { impl } = fakeFetch(404, { code: 1, type: "error", message: "Ticket 9 not found" });
    const client = new GestsupClient(cfg, impl);
    await expect(client.getTicket(9)).rejects.toThrow(/introuvable/i);
  });
});

describe("GestsupClient.findTicketsByUser", () => {
  it("renvoie une liste vide quand aucun ticket (404 No tickets)", async () => {
    const { impl } = fakeFetch(404, { code: 1, type: "error", message: "No tickets found for user id 5" });
    const client = new GestsupClient(cfg, impl);
    const r = await client.findTicketsByUser({
      user_id: 5,
      order: "id",
      sort: "ASC",
      limit: 10,
      page: 0,
    });
    expect(r).toEqual([]);
  });

  it("lève une erreur si l'utilisateur n'existe pas", async () => {
    const { impl } = fakeFetch(404, { code: 1, type: "error", message: "User not found in database application (5)" });
    const client = new GestsupClient(cfg, impl);
    await expect(
      client.findTicketsByUser({ user_id: 5, order: "id", sort: "ASC", limit: 10, page: 0 }),
    ).rejects.toThrow(/introuvable/i);
  });

  it("décode et mappe une liste de tickets, en passant offset = page", async () => {
    const { impl, calls } = fakeFetch(200, [
      {
        code: "0",
        type: "success",
        ticket_id: 1,
        ticket_subject: "Imprimante &amp; co",
        ticket_state_id: 5,
        ticket_state_name: "Nouveau",
        ticket_date_create: "2025-02-01 10:00:00",
        ticket_date_modif: "2025-02-02 09:00:00",
      },
    ]);
    const client = new GestsupClient(cfg, impl);
    const r = await client.findTicketsByUser({
      user_id: 5,
      order: "date_create",
      sort: "DESC",
      limit: 10,
      page: 2,
    });
    expect(r).toHaveLength(1);
    expect(r[0].subject).toBe("Imprimante & co");
    expect(calls[0].url).toContain("offset=2");
    expect(calls[0].url).toContain("limit=10");
  });
});

describe("GestsupClient.listReferential", () => {
  it("mappe les types", async () => {
    const { impl } = fakeFetch(200, [
      { code: "0", type: "success", action: "TicketTypeList", type_id: 1, type_name: "Incident" },
    ]);
    const client = new GestsupClient(cfg, impl);
    const r = await client.listReferential("type");
    expect(r).toEqual([{ id: "1", name: "Incident" }]);
  });

  it("mappe les sous-catégories avec la catégorie parente", async () => {
    const { impl } = fakeFetch(200, [
      { code: "0", action: "TicketCategoryList", category_id: 3, subcat_id: 7, subcat_name: "Wi-Fi" },
    ]);
    const client = new GestsupClient(cfg, impl);
    const r = await client.listReferential("subcat");
    expect(r).toEqual([{ id: "7", name: "Wi-Fi", category_id: "3" }]);
  });
});

describe("GestsupClient.searchTickets (plugin gestsup_mcp)", () => {
  it("appelle l'endpoint plugin, passe offset = page*limit et décode", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketList",
      count: 1,
      total: 12,
      limit: 10,
      offset: 20,
      tickets: [
        {
          ticket_id: 5,
          title: "Souci &amp; co",
          state_id: 3,
          state_name: "En cours",
          technician_id: 12,
          technician_name: "Jean Dupont",
          user_id: 42,
          requester_name: "Marie Martin",
          date_create: "2025-02-01 10:00:00",
          date_modif: "2025-02-02 09:00:00",
        },
      ],
    });
    const client = new GestsupClient(cfg, impl);
    const r = await client.searchTickets({
      technician_id: 12,
      order: "date_create",
      sort: "DESC",
      limit: 10,
      page: 2,
    });
    expect(r.total).toBe(12);
    expect(r.tickets[0].title).toBe("Souci & co");
    expect(r.tickets[0].technician_name).toBe("Jean Dupont");
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/tickets.php");
    expect(calls[0].url).toContain("technician=12");
    expect(calls[0].url).toContain("offset=20"); // page 2 * limit 10
  });

  it("explique clairement si le plugin n'est pas installé (404)", async () => {
    const { impl } = fakeFetch(404, "Not Found");
    const client = new GestsupClient(cfg, impl);
    await expect(
      client.searchTickets({ order: "id", sort: "ASC", limit: 10, page: 0 }),
    ).rejects.toThrow(/gestsup_mcp/);
  });
});

describe("GestsupClient (auth basic)", () => {
  it("envoie l'en-tête Authorization Basic", async () => {
    const { impl, calls } = fakeFetch(200, { code: 0, ticket_id: 1, ticket_url: "u", message: "m" });
    const client = new GestsupClient({ ...cfg, authMode: "basic" }, impl);
    await client.createTicket({ title: "T", description: "D" });
    const expected = "Basic " + Buffer.from("TESTKEY").toString("base64");
    expect(calls[0].headers["Authorization"]).toBe(expected);
  });
});
