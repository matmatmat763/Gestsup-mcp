import { describe, it, expect } from "vitest";
import { tokenize, coverage, findSimilarNotes } from "../src/similar.js";
import type { Ticket } from "../src/normalize.js";
import type { NoteContent } from "../src/vault/store.js";

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: "1234",
    technician: "Jean",
    type_id: "2",
    type_name: "Incident",
    title: "Imprimante hors service au site Lyon",
    description: "Voyant rouge, plus aucune impression depuis ce matin.",
    date_create: "2025-02-01 10:00:00",
    date_create_fr: "01/02/2025",
    state_id: "3",
    state_name: "Résolu",
    resolution: [
      {
        thread_id: "1",
        thread_type_id: "0",
        thread_type_name: "text",
        thread_date: "2025-02-01 11:00:00",
        thread_author: "Jean",
        thread_text: "Remplacement du toner et redémarrage du spouleur, impression rétablie.",
      },
    ],
    ...over,
  };
}

function note(path: string, title: string, body: string, fm: Record<string, unknown> = {}): NoteContent {
  return { path, title, exists: true, frontmatter: { title, ...fm }, body };
}

describe("tokenize / coverage", () => {
  it("retire accents, mots vides et termes courts", () => {
    const t = tokenize("L'imprimante à Lyon est HS");
    expect(t.has("imprimante")).toBe(true);
    expect(t.has("lyon")).toBe(true);
    expect(t.has("est")).toBe(false); // stopword
    expect(t.has("hs")).toBe(false); // < 3 lettres
  });

  it("coverage = part des termes de a présents dans b", () => {
    expect(coverage(tokenize("toner spouleur"), tokenize("remplacement du toner"))).toBeCloseTo(0.5);
    expect(coverage(new Set(), tokenize("x"))).toBe(0);
  });
});

describe("findSimilarNotes", () => {
  it("détecte un doublon : même problème ET même résolution", () => {
    const notes = [
      note(
        "KB/imprimante-toner.md",
        "Imprimante hors service Lyon",
        "Problème d'impression, voyant rouge. Résolution : remplacement du toner et redémarrage du spouleur.",
      ),
      note("KB/vpn.md", "Accès VPN", "Création d'un compte VPN distant."),
    ];
    const r = findSimilarNotes(ticket(), notes);
    expect(r.duplicate).toBeDefined();
    expect(r.duplicate?.path).toBe("KB/imprimante-toner.md");
  });

  it("pas de doublon si le problème est proche mais la résolution diffère", () => {
    const notes = [
      note(
        "KB/imprimante-bourrage.md",
        "Imprimante hors service Lyon",
        "Voyant rouge, plus d'impression. Résolution : retrait d'un bourrage papier dans le bac.",
      ),
    ];
    const r = findSimilarNotes(ticket(), notes);
    // pertinent mais résolution (toner/spouleur) non couverte
    expect(r.candidates[0].relevance).toBeGreaterThan(0.4);
    expect(r.duplicate).toBeUndefined();
  });

  it("reconnaît une note documentant déjà CE ticket (frontmatter)", () => {
    const notes = [note("KB/x.md", "Autre sujet", "Contenu sans rapport.", { gestsup_ticket_id: 1234 })];
    const r = findSimilarNotes(ticket(), notes);
    expect(r.duplicate?.sameTicket).toBe(true);
  });

  it("aucun doublon quand la doc est vide", () => {
    const r = findSimilarNotes(ticket(), []);
    expect(r.duplicate).toBeUndefined();
    expect(r.candidates).toHaveLength(0);
  });
});
