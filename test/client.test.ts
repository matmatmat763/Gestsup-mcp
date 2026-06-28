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

describe("GestsupClient.addComment (plugin gestsup_mcp)", () => {
  it("poste au plugin avec author_id, en urlencoded, et mappe la réponse", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketComment",
      ticket_id: "1",
      thread_id: "9",
      private: 0,
      notified: true,
      mail: "sent",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 10 }, impl);
    const r = await client.addComment({ ticket_id: 1, text: "Bonjour", isPrivate: false, time: 5 });
    expect(r.thread_id).toBe("9");
    expect(r.notified).toBe(true);
    expect(r.isPrivate).toBe(false);
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/ticket_comment.php");
    expect(calls[0].method).toBe("POST");
  });

  it("exige GESTSUP_DEFAULT_USER_ID", async () => {
    const { impl } = fakeFetch(200, {});
    const client = new GestsupClient(cfg, impl); // sans defaultUserId
    await expect(
      client.addComment({ ticket_id: 1, text: "x", isPrivate: false }),
    ).rejects.toThrow(/DEFAULT_USER_ID/);
  });

  it("signale clairement si le plugin n'est pas installé (404)", async () => {
    const { impl } = fakeFetch(404, "Not Found");
    const client = new GestsupClient({ ...cfg, defaultUserId: 10 }, impl);
    await expect(
      client.addComment({ ticket_id: 1, text: "x", isPrivate: false }),
    ).rejects.toThrow(/gestsup_mcp/);
  });
});

describe("GestsupClient.closeTicket (plugin gestsup_mcp)", () => {
  it("clôture avec cause + procédure et mappe la réponse", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketClose",
      ticket_id: "4",
      resolved: true,
      cause_appended: true,
      procedure: "Réinstallation",
      mail: "sent",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 11 }, impl);
    const r = await client.closeTicket({ ticket_id: 4, cause: "Disque HS", procedure_text: "Remplacement" });
    expect(r.resolved).toBe(true);
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/ticket_close.php");
  });

  it("remonte le refus de clôture non conforme (400)", async () => {
    const { impl } = fakeFetch(400, {
      code: 1,
      type: "error",
      message: "Clôture non conforme : la CAUSE de résolution est requise.",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 11 }, impl);
    await expect(
      client.closeTicket({ ticket_id: 4, cause: "", procedure_text: "x" }),
    ).rejects.toThrow(/non conforme/);
  });
});

describe("GestsupClient.updateTicket (plugin gestsup_mcp)", () => {
  it("envoie les champs au plugin et mappe la réponse", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketUpdate",
      ticket_id: "3",
      updated: { priority: 1, criticality: 2 },
      mail: "sent",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 1 }, impl);
    const r = await client.updateTicket({ ticket_id: 3, priority_id: 1, criticality_id: 2 });
    expect(r.updated).toEqual({ priority: 1, criticality: 2 });
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/ticket_update.php");
    expect(calls[0].method).toBe("POST");
  });

  it("remonte une erreur 400 (valeur invalide dans l'instance)", async () => {
    const { impl } = fakeFetch(400, {
      code: 1,
      type: "error",
      message: "Valeur priority=99 inconnue dans l'instance (référentiel tpriority).",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 1 }, impl);
    await expect(client.updateTicket({ ticket_id: 3, priority_id: 99 })).rejects.toThrow(/inconnue/);
  });
});

describe("GestsupClient.assign (plugin gestsup_mcp)", () => {
  it("affecte à un technicien via le plugin", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketAssign",
      ticket_id: "10",
      assigned_to: "technician",
      technician: "11",
      group: "0",
      history: "attribution",
      new_state: "1",
      mail: "sent",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 1 }, impl);
    const r = await client.assign({ ticket_id: 10, technician_id: 11 });
    expect(r.assigned_to).toBe("technician");
    expect(r.history).toBe("attribution");
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/ticket_assign.php");
  });

  it("exige technician_id ou group_id", async () => {
    const { impl } = fakeFetch(200, {});
    const client = new GestsupClient({ ...cfg, defaultUserId: 1 }, impl);
    await expect(client.assign({ ticket_id: 10 })).rejects.toThrow(/technician_id ou group_id/);
  });
});

describe("GestsupClient.setState (plugin gestsup_mcp)", () => {
  it("poste au plugin ticket_state.php et mappe la résolution", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      action: "TicketState",
      ticket_id: "5",
      old_state: "1",
      new_state: "3",
      state_name: "Résolu",
      resolved: true,
      comment: "added",
      mail: "sent",
    });
    const client = new GestsupClient({ ...cfg, defaultUserId: 11 }, impl);
    const r = await client.setState({ ticket_id: 5, state_id: 3, text: "ok" });
    expect(r.resolved).toBe(true);
    expect(r.state_name).toBe("Résolu");
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/ticket_state.php");
    expect(calls[0].method).toBe("POST");
  });
});

describe("GestsupClient.listReferential (états via plugin)", () => {
  it("lit les états dynamiquement via le plugin", async () => {
    const { impl, calls } = fakeFetch(200, {
      code: 0,
      type: "success",
      kind: "state",
      items: [{ id: 3, name: "Résolu", number: 5, meta: 0, hidden: 0 }],
    });
    const client = new GestsupClient(cfg, impl);
    const r = await client.listReferential("state");
    expect(r[0].id).toBe("3");
    expect(r[0].name).toBe("Résolu");
    expect(r[0].number).toBe(5);
    expect(calls[0].url).toContain("/plugins/gestsup_mcp/referentials.php");
    expect(calls[0].url).toContain("kind=state");
  });

  it("conserve l'API native pour les types", async () => {
    const { impl, calls } = fakeFetch(200, [
      { code: "0", action: "TicketTypeList", type_id: 1, type_name: "Incident" },
    ]);
    const client = new GestsupClient(cfg, impl);
    const r = await client.listReferential("type");
    expect(r).toEqual([{ id: "1", name: "Incident" }]);
    expect(calls[0].url).toContain("/api/v1/ticket/type/");
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
