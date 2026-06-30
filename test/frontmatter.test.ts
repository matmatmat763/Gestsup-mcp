import { describe, it, expect } from "vitest";
import { parseNote, stringifyNote, serializeFrontmatter } from "../src/vault/frontmatter.js";

describe("frontmatter parse/serialize", () => {
  it("parse un frontmatter simple + corps", () => {
    const { frontmatter, body } = parseNote(
      `---\ntitle: "Imprimante HS"\ntags: [gestsup, incident]\ngestsup_ticket_id: 1234\n---\n\n# Titre\n\nCorps.`,
    );
    expect(frontmatter.title).toBe("Imprimante HS");
    expect(frontmatter.tags).toEqual(["gestsup", "incident"]);
    expect(frontmatter.gestsup_ticket_id).toBe(1234);
    expect(body).toBe("# Titre\n\nCorps.");
  });

  it("traite l'absence de frontmatter comme corps pur", () => {
    const { frontmatter, body } = parseNote("Juste du texte\nsur deux lignes.");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Juste du texte\nsur deux lignes.");
  });

  it("ne confond pas une fence non fermée avec du frontmatter", () => {
    const { frontmatter, body } = parseNote("---\npas de fin");
    expect(frontmatter).toEqual({});
    expect(body).toBe("---\npas de fin");
  });

  it("aller-retour stable", () => {
    const md = stringifyNote({ title: "A: B", tags: ["x", "y"], n: 3, flag: true }, "Corps");
    const { frontmatter, body } = parseNote(md);
    expect(frontmatter.title).toBe("A: B");
    expect(frontmatter.tags).toEqual(["x", "y"]);
    expect(frontmatter.n).toBe(3);
    expect(frontmatter.flag).toBe(true);
    expect(body.trimEnd()).toBe("Corps");
  });

  it("met des guillemets sur les valeurs ambiguës", () => {
    const out = serializeFrontmatter({ a: "true", b: "12", c: "x: y" });
    expect(out).toContain('a: "true"');
    expect(out).toContain('b: "12"');
    expect(out).toContain('c: "x: y"');
  });

  it("frontmatter vide → pas de bloc", () => {
    expect(serializeFrontmatter({})).toBe("");
  });
});
