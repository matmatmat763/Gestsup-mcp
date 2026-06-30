import { describe, it, expect } from "vitest";
import { renderTicketNote, slugify } from "../src/docTemplate.js";
import type { Ticket } from "../src/normalize.js";

const ticket: Ticket = {
  ticket_id: "1234",
  technician: "Jean Dupont",
  type_id: "2",
  type_name: "Incident",
  title: "Imprimante HS — site Lyon",
  description: "Voyant rouge, plus d'impression.",
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
      thread_text: "Remplacement du toner.",
    },
  ],
};

describe("slugify", () => {
  it("normalise accents/espaces/symboles", () => {
    expect(slugify("Imprimante HS — site Lyon")).toBe("imprimante-hs-site-lyon");
    expect(slugify("Accès VPN (réseau)")).toBe("acces-vpn-reseau");
    expect(slugify("")).toBe("note");
  });
});

describe("renderTicketNote", () => {
  it("rend frontmatter + sections + lien", () => {
    const r = renderTicketNote(ticket, "https://support.exemple.fr/");
    expect(r.slug).toBe("ticket-1234-imprimante-hs-site-lyon");
    expect(r.frontmatter.gestsup_ticket_id).toBe(1234);
    expect(r.frontmatter.source).toBe("gestsup");
    expect(r.frontmatter.tags).toContain("gestsup");
    expect(r.frontmatter.tags).toContain("incident");
    expect(r.body).toContain("## Problème");
    expect(r.body).toContain("Voyant rouge");
    expect(r.body).toContain("## Résolution");
    expect(r.body).toContain("Remplacement du toner.");
    expect(r.body).toContain(
      "https://support.exemple.fr/index.php?page=ticket&id=1234",
    );
  });

  it("gère un ticket sans résolution", () => {
    const r = renderTicketNote({ ...ticket, resolution: [] }, "https://x.fr");
    expect(r.body).toContain("_(aucun élément de résolution consigné)_");
  });
});
