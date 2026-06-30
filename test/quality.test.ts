import { describe, it, expect } from "vitest";
import { assessTicketQuality } from "../src/quality.js";
import type { Ticket } from "../src/normalize.js";

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: "1234",
    technician: "Jean Dupont",
    type_id: "2",
    type_name: "Incident",
    title: "Imprimante hors service au site Lyon",
    description: "L'imprimante du 2e étage ne répond plus depuis ce matin, voyant rouge.",
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
        thread_author: "Jean Dupont",
        thread_text: "Remplacement du toner et redémarrage du spouleur, test d'impression OK.",
      },
      {
        thread_id: "2",
        thread_type_id: "4",
        thread_type_name: "closure",
        thread_date: "2025-02-01 11:30:00",
        thread_author: "Jean Dupont",
        thread_text: "Clôture : problème résolu.",
      },
    ],
    ...overrides,
  };
}

describe("assessTicketQuality", () => {
  it("juge documentable un ticket riche et résolu", () => {
    const r = assessTicketQuality(ticket(), 60);
    expect(r.score).toBe(100);
    expect(r.documentable).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  it("juge pauvre un ticket vide et liste les manques", () => {
    const r = assessTicketQuality(
      ticket({ description: "rien", title: "bug", resolution: [], type_id: "0", type_name: "" }),
      60,
    );
    expect(r.documentable).toBe(false);
    expect(r.score).toBeLessThan(60);
    expect(r.missing).toContain("Description suffisamment détaillée");
    expect(r.missing).toContain("Résolution / commentaires consignés");
  });

  it("respecte le seuil fourni", () => {
    // Description OK (30) + titre OK (10) = 40, pas de résolution.
    const t = ticket({ resolution: [], state_id: "5", state_name: "Nouveau" });
    expect(assessTicketQuality(t, 60).documentable).toBe(false);
    expect(assessTicketQuality(t, 40).documentable).toBe(true);
  });

  it("ne compte pas les threads d'attribution comme résolution", () => {
    const t = ticket({
      resolution: [
        {
          thread_id: "1",
          thread_type_id: "1",
          thread_type_name: "attribution",
          thread_date: "2025-02-01 10:05:00",
          thread_author: "Système",
          thread_text:
            "Attribué à Jean Dupont (texte assez long pour dépasser le seuil de contenu).",
        },
      ],
    });
    const r = assessTicketQuality(t, 60);
    expect(r.signals.find((s) => s.key === "resolution")?.ok).toBe(false);
  });
});
