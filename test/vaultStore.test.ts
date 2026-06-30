import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultStore, VaultError } from "../src/vault/store.js";

let root: string;
let vault: VaultStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "vault-"));
  vault = new VaultStore({ root, docsFolder: "KB", allowWrites: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("VaultStore — sécurité des chemins", () => {
  it("refuse l'évasion par ..", async () => {
    await expect(vault.readNote("../escape.md")).rejects.toBeInstanceOf(VaultError);
  });

  it("refuse un chemin absolu", async () => {
    await expect(vault.readNote("/etc/passwd")).rejects.toBeInstanceOf(VaultError);
  });
});

describe("VaultStore — write/read", () => {
  it("crée puis relit une note avec frontmatter", async () => {
    const r = await vault.writeNote({ path: "KB/test.md", body: "# Hello\n\nCorps", frontmatter: { tags: ["a"] } });
    expect(r.created).toBe(true);
    const note = await vault.readNote("KB/test");
    expect(note.exists).toBe(true);
    expect(note.frontmatter.tags).toEqual(["a"]);
    expect(note.frontmatter.created).toBeDefined();
    expect(note.frontmatter.updated).toBeDefined();
    expect(note.body).toContain("# Hello");
  });

  it("mode create échoue si la note existe", async () => {
    await vault.writeNote({ path: "KB/dup.md", body: "x" });
    await expect(vault.writeNote({ path: "KB/dup.md", body: "y" })).rejects.toMatchObject({ code: "EXISTS" });
  });

  it("mode overwrite remplace", async () => {
    await vault.writeNote({ path: "KB/ow.md", body: "v1" });
    const r = await vault.writeNote({ path: "KB/ow.md", body: "v2", mode: "overwrite" });
    expect(r.created).toBe(false);
    const note = await vault.readNote("KB/ow.md");
    expect(note.body).toContain("v2");
  });

  it("note inexistante → exists=false", async () => {
    const note = await vault.readNote("KB/nope.md");
    expect(note.exists).toBe(false);
  });

  it("refuse l'écriture en lecture seule", async () => {
    const ro = new VaultStore({ root, docsFolder: "KB", allowWrites: false });
    await expect(ro.writeNote({ path: "KB/x.md", body: "x" })).rejects.toMatchObject({ code: "READONLY" });
  });
});

describe("VaultStore — appendSection", () => {
  it("crée une note avec une section si absente", async () => {
    const r = await vault.appendSection({ path: "KB/s.md", heading: "Notes", content: "ligne 1" });
    expect(r.created).toBe(true);
    const note = await vault.readNote("KB/s.md");
    expect(note.body).toContain("## Notes");
    expect(note.body).toContain("ligne 1");
  });

  it("ajoute à la suite d'une section existante (append)", async () => {
    await vault.appendSection({ path: "KB/s.md", heading: "Notes", content: "ligne 1" });
    await vault.appendSection({ path: "KB/s.md", heading: "Notes", content: "ligne 2" });
    const note = await vault.readNote("KB/s.md");
    expect(note.body).toContain("ligne 1");
    expect(note.body).toContain("ligne 2");
    // une seule occurrence du titre
    expect(note.body.match(/## Notes/g)).toHaveLength(1);
  });

  it("remplace le contenu d'une section (replace)", async () => {
    await vault.appendSection({ path: "KB/s.md", heading: "Notes", content: "ancien" });
    const r = await vault.appendSection({ path: "KB/s.md", heading: "Notes", content: "nouveau", mode: "replace" });
    expect(r.sectionReplaced).toBe(true);
    const note = await vault.readNote("KB/s.md");
    expect(note.body).toContain("nouveau");
    expect(note.body).not.toContain("ancien");
  });

  it("n'affecte pas les sections voisines", async () => {
    await vault.writeNote({ path: "KB/m.md", body: "## A\n\naaa\n\n## B\n\nbbb", mode: "overwrite" });
    await vault.appendSection({ path: "KB/m.md", heading: "A", content: "plus", mode: "append" });
    const note = await vault.readNote("KB/m.md");
    expect(note.body).toContain("aaa");
    expect(note.body).toContain("plus");
    expect(note.body).toContain("## B");
    expect(note.body).toContain("bbb");
  });
});

describe("VaultStore — accessibilité (partage réseau)", () => {
  it("healthCheck OK sur un vault existant et écrivable", async () => {
    const h = await vault.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.writable).toBe(true);
  });

  it("healthCheck signale un vault introuvable (partage démonté)", async () => {
    const gone = new VaultStore({ root: path.join(root, "absent"), docsFolder: "KB", allowWrites: true });
    const h = await gone.healthCheck();
    expect(h.ok).toBe(false);
    expect(h.message.toLowerCase()).toContain("mont");
  });

  it("readNote sur un vault injoignable lève UNREACHABLE", async () => {
    const gone = new VaultStore({ root: path.join(root, "absent"), docsFolder: "KB", allowWrites: true });
    await expect(gone.readNote("KB/x.md")).rejects.toMatchObject({ code: "UNREACHABLE" });
  });

  it("search/list sur un vault injoignable lèvent UNREACHABLE", async () => {
    const gone = new VaultStore({ root: path.join(root, "absent"), docsFolder: "KB", allowWrites: true });
    await expect(gone.listNotes({})).rejects.toMatchObject({ code: "UNREACHABLE" });
    await expect(gone.search({ query: "x" })).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});

describe("VaultStore — list/search", () => {
  it("liste et recherche dans le corps et les tags", async () => {
    await vault.writeNote({ path: "KB/imprimante.md", body: "Le toner est vide.", frontmatter: { tags: ["materiel"] } });
    await vault.writeNote({ path: "KB/vpn.md", body: "Accès distant." });
    const all = await vault.listNotes({});
    expect(all.map((n) => n.path).sort()).toEqual(["KB/imprimante.md", "KB/vpn.md"]);

    const byBody = await vault.search({ query: "toner" });
    expect(byBody).toHaveLength(1);
    expect(byBody[0].path).toBe("KB/imprimante.md");
    expect(byBody[0].matchedIn).toBe("body");

    const byTag = await vault.search({ query: "materiel" });
    expect(byTag[0].matchedIn).toBe("tags");
  });
});
