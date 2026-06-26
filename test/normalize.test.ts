import { describe, it, expect } from "vitest";
import {
  decodeHtml,
  isSuccess,
  normalizeTicket,
  normalizeTicketSummary,
} from "../src/normalize.js";

describe("decodeHtml", () => {
  it("décode les entités htmlspecialchars(ENT_QUOTES)", () => {
    expect(decodeHtml("&lt;b&gt;Imprimante&lt;/b&gt;")).toBe("<b>Imprimante</b>");
    expect(decodeHtml("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeHtml("d&#039;accord")).toBe("d'accord");
    expect(decodeHtml("&quot;test&quot;")).toBe('"test"');
  });

  it("gère null/undefined/nombres", () => {
    expect(decodeHtml(null)).toBe("");
    expect(decodeHtml(undefined)).toBe("");
    expect(decodeHtml(42)).toBe("42");
  });
});

describe("isSuccess", () => {
  it("accepte code numérique ou string et type success", () => {
    expect(isSuccess({ code: 0 })).toBe(true);
    expect(isSuccess({ code: "0" })).toBe(true);
    expect(isSuccess({ type: "success" })).toBe(true);
    expect(isSuccess({ code: 1, type: "error" })).toBe(false);
    expect(isSuccess(null)).toBe(false);
    expect(isSuccess([])).toBe(false);
  });
});

describe("normalizeTicket", () => {
  it("normalise un ticket et son fil de résolution", () => {
    const t = normalizeTicket({
      code: "0",
      ticket_id: "1234",
      ticket_technician: "Jean Dupont",
      ticket_type_id: "2",
      ticket_type_name: "Incident",
      ticket_title: "Imprimante &amp; scanner HS",
      ticket_description: "d&#039;urgence",
      ticket_state_id: "5",
      ticket_state_name: "Nouveau",
      ticket_resolution: [
        {
          thread_id: "1",
          thread_type_id: "0",
          thread_type_name: "text",
          thread_date: "2025-02-01 10:05:00",
          thread_author: "Jean Dupont",
          thread_text: "Bonjour &lt;3",
        },
      ],
    });
    expect(t.ticket_id).toBe("1234");
    expect(t.title).toBe("Imprimante & scanner HS");
    expect(t.description).toBe("d'urgence");
    expect(t.resolution).toHaveLength(1);
    expect(t.resolution[0].thread_text).toBe("Bonjour <3");
  });
});

describe("normalizeTicketSummary", () => {
  it("décode le sujet", () => {
    const s = normalizeTicketSummary({
      ticket_id: "7",
      ticket_subject: "Probl&#039;eme",
      ticket_state_id: "5",
      ticket_state_name: "Nouveau",
      ticket_date_create: "2025-02-01 10:00:00",
      ticket_date_modif: "2025-02-02 09:00:00",
    });
    expect(s.subject).toBe("Probl'eme");
    expect(s.ticket_id).toBe("7");
  });
});
