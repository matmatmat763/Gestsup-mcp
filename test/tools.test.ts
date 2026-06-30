import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerTools } from "../src/tools.js";
import { VaultStore } from "../src/vault/store.js";
import type { Config } from "../src/config.js";
import type { GestsupClient } from "../src/gestsupClient.js";
import type { Ticket } from "../src/normalize.js";

/** Faux serveur MCP : capture les handlers d'outils par nom. */
type Handler = (args: any) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
class FakeServer {
  handlers = new Map<string, Handler>();
  registerTool(name: string, _def: unknown, handler: Handler) {
    this.handlers.set(name, handler);
  }
  async call(name: string, args: any = {}) {
    const h = this.handlers.get(name);
    if (!h) throw new Error(`Outil non enregistré : ${name}`);
    return h(args);
  }
  text(name: string, args: any = {}) {
    return this.call(name, args).then((r) => r.content.map((c) => c.text).join("\n"));
  }
}

const richTicket: Ticket = {
  ticket_id: "1234",
  technician: "Paul",
  type_id: "2",
  type_name: "Incident",
  title: "Imprimante hors service au site Lyon",
  description: "Voyant rouge, plus aucune impression depuis ce matin sur l'étage 2.",
  date_create: "2025-02-01 10:00:00",
  date_create_fr: "01/02/2025 10:00",
  state_id: "3",
  state_name: "Résolu",
  resolution: [
    {
      thread_id: "1",
      thread_type_id: "0",
      thread_type_name: "text",
      thread_date: "2025-02-01 11:00:00",
      thread_author: "Paul",
      thread_text: "Remplacement du toner et redémarrage du spouleur, impression rétablie.",
    },
  ],
};

function mockClient(over: Partial<Record<keyof GestsupClient, any>> = {}): GestsupClient {
  const base: any = {
    getTicket: async () => richTicket,
    createTicket: async () => ({ ticket_id: "9", ticket_url: "u", message: "ok" }),
    closeTicket: async () => ({ ticket_type: "Incident", cause_appended: true, cause_required: true, mail: "sent" }),
  };
  return { ...base, ...over } as GestsupClient;
}

function cfg(over: Partial<Config> = {}): Config {
  return {
    baseUrl: "https://support.exemple.fr",
    apiKey: "k",
    authMode: "header",
    timeoutMs: 15000,
    allowWrites: true,
    insecureTls: false,
    vaultDocsFolder: "KB",
    vaultAllowWrites: true,
    docQualityThreshold: 60,
    ...over,
  } as Config;
}

let root: string;
let vault: VaultStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "tools-"));
  vault = new VaultStore({ root, docsFolder: "KB", allowWrites: true });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("registerTools — enregistrement", () => {
  it("enregistre les outils GestSup, et les outils vault seulement si vault fourni", () => {
    const noVault = new FakeServer();
    registerTools(noVault as any, mockClient(), cfg());
    expect(noVault.handlers.has("gestsup_get_ticket")).toBe(true);
    expect(noVault.handlers.has("gestsup_assess_ticket_quality")).toBe(true);
    expect(noVault.handlers.has("obsidian_write_note")).toBe(false);
    expect(noVault.handlers.has("gestsup_document_ticket")).toBe(false);

    const withVault = new FakeServer();
    registerTools(withVault as any, mockClient(), cfg(), vault);
    expect(withVault.handlers.has("obsidian_write_note")).toBe(true);
    expect(withVault.handlers.has("gestsup_document_ticket")).toBe(true);
    expect(withVault.handlers.has("gestsup_suggest_documentation")).toBe(true);
  });
});

describe("kill-switch d'écriture", () => {
  it("refuse les écritures GestSup quand allowWrites=false", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg({ allowWrites: false }), vault);
    const r = await s.call("gestsup_create_ticket", { title: "x", description: "y" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Écriture désactivée");
  });

  it("refuse l'écriture vault quand OBSIDIAN_ALLOW_WRITES=false", async () => {
    const ro = new VaultStore({ root, docsFolder: "KB", allowWrites: false });
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), ro);
    const r = await s.call("obsidian_write_note", { path: "KB/x.md", body: "z" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("désactivée");
  });
});

describe("gestsup_assess_ticket_quality", () => {
  it("renvoie un rapport documentable pour un ticket riche", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    const r = await s.call("gestsup_assess_ticket_quality", { ticket_id: 1234 });
    expect(r.content[0].text).toContain("documentable");
  });
});

describe("gestsup_document_ticket", () => {
  it("dry_run rend le markdown SANS écrire", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    const r = await s.call("gestsup_document_ticket", { ticket_id: 1234, mode: "dry_run" });
    expect(r.content[0].text).toContain("dry_run");
    const notes = await vault.listNotes({});
    expect(notes).toHaveLength(0); // rien écrit
  });

  it("create écrit une note KB", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    await s.call("gestsup_document_ticket", { ticket_id: 1234, mode: "create" });
    const notes = await vault.listNotes({});
    expect(notes).toHaveLength(1);
    expect(notes[0].path).toContain("ticket-1234");
  });

  it("skip_if_poor n'écrit pas un ticket pauvre", async () => {
    const poor: Ticket = { ...richTicket, description: "x", title: "bug", resolution: [], type_id: "0", type_name: "" };
    const s = new FakeServer();
    registerTools(s as any, mockClient({ getTicket: async () => poor }), cfg(), vault);
    const r = await s.call("gestsup_document_ticket", { ticket_id: 1234, mode: "create", skip_if_poor: true });
    expect(r.content[0].text).toContain("ignorée");
    expect(await vault.listNotes({})).toHaveLength(0);
  });
});

describe("gestsup_suggest_documentation + clôture", () => {
  it("recommande de documenter quand la doc est vide", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    const r = await s.call("gestsup_suggest_documentation", { ticket_id: 1234 });
    expect(r.content[0].text.toLowerCase()).toContain("aucun cas similaire");
  });

  it("détecte un doublon (même résolution déjà en doc)", async () => {
    await vault.writeNote({
      path: "KB/imprimante.md",
      body: "Imprimante hors service Lyon. Résolution : remplacement du toner et redémarrage du spouleur.",
      frontmatter: { title: "Imprimante hors service au site Lyon" },
    });
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    const r = await s.call("gestsup_suggest_documentation", { ticket_id: 1234 });
    expect(r.content[0].text.toLowerCase()).toContain("similaire");
  });

  it("la réponse de clôture inclut la suggestion de documentation", async () => {
    const s = new FakeServer();
    registerTools(s as any, mockClient(), cfg(), vault);
    const r = await s.call("gestsup_close_ticket", { ticket_id: 1234, resolution: "fait", cause: "panne" });
    expect(r.content[0].text).toContain("📓");
  });
});
