import { describe, it, expect } from "vitest";
import { GestsupError, mapError } from "../src/errors.js";

describe("GestsupError", () => {
  it("porte le nom, le statut et l'action", () => {
    const err = new GestsupError("boom", 500, "TicketCreate");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GestsupError");
    expect(err.message).toBe("boom");
    expect(err.status).toBe(500);
    expect(err.action).toBe("TicketCreate");
  });

  it("tolère un statut et une action absents", () => {
    const err = new GestsupError("boom");
    expect(err.status).toBeUndefined();
    expect(err.action).toBeUndefined();
  });
});

describe("mapError", () => {
  it("400 : requête invalide, message API en suffixe", () => {
    const err = mapError(400, { message: "champ manquant" }, "TicketCreate");
    expect(err.status).toBe(400);
    expect(err.action).toBe("TicketCreate");
    expect(err.message).toBe("Requête invalide (400) : champ manquant.");
  });

  it("403 : message pédagogique multi-causes", () => {
    const err = mapError(403, { message: "Wrong API Key" }, "UserTicket");
    expect(err.status).toBe(403);
    expect(err.message).toContain("Wrong API Key");
    expect(err.message).toContain("liste blanche");
  });

  it("404 : reprend le message API tel quel s'il existe", () => {
    expect(mapError(404, { message: "Ticket inconnu" }, "Ticket").message).toBe("Ticket inconnu");
    expect(mapError(404, {}, "Ticket").message).toBe("Ressource introuvable (404).");
  });

  it("405 : opération non disponible dans cette version", () => {
    const err = mapError(405, null, "TicketClose");
    expect(err.status).toBe(405);
    expect(err.message).toContain("non disponible dans cette version de GestSup (405)");
  });

  it("500 : erreur interne GestSup", () => {
    const err = mapError(500, { message: "SQL error" }, "TicketCreate");
    expect(err.message).toBe("Erreur interne GestSup (500) : SQL error.");
  });

  it("statut inconnu : message API sinon message générique", () => {
    expect(mapError(418, { message: "teapot" }, "X").message).toBe("teapot");
    expect(mapError(418, {}, "X").message).toBe("Erreur GestSup (HTTP 418).");
    expect(mapError(418, {}, "X").status).toBe(418);
  });

  it("ignore les corps non-objets et les messages vides", () => {
    expect(mapError(400, "oops", "X").message).toBe("Requête invalide (400).");
    expect(mapError(400, { message: null }, "X").message).toBe("Requête invalide (400).");
    expect(mapError(400, undefined, "X").message).toBe("Requête invalide (400).");
  });
});
