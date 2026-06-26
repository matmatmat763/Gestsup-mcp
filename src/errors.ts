/** Erreur normalisée issue d'un appel à l'API GestSup. */
export class GestsupError extends Error {
  readonly status?: number;
  readonly action?: string;

  constructor(message: string, status?: number, action?: string) {
    super(message);
    this.name = "GestsupError";
    this.status = status;
    this.action = action;
  }
}

/**
 * Convertit un statut HTTP + corps d'erreur GestSup en GestsupError lisible,
 * en gommant les pièges documentés (403 multi-causes, 405 = endpoint désactivé…).
 */
export function mapError(status: number, body: unknown, action: string): GestsupError {
  const apiMsg =
    body && typeof body === "object" && "message" in body
      ? String((body as Record<string, unknown>).message ?? "")
      : "";
  const suffix = apiMsg ? ` : ${apiMsg}` : "";

  switch (status) {
    case 400:
      return new GestsupError(`Requête invalide (400)${suffix}.`, 400, action);
    case 403:
      return new GestsupError(
        `Accès refusé par GestSup (403)${suffix}. Vérifiez : API activée, clé correcte, accès en HTTPS, et IP du serveur MCP autorisée dans la liste blanche.`,
        403,
        action,
      );
    case 404:
      return new GestsupError(apiMsg || "Ressource introuvable (404).", 404, action);
    case 405:
      return new GestsupError(
        `Opération non disponible dans cette version de GestSup (405)${suffix}.`,
        405,
        action,
      );
    case 500:
      return new GestsupError(`Erreur interne GestSup (500)${suffix}.`, 500, action);
    default:
      return new GestsupError(
        apiMsg || `Erreur GestSup (HTTP ${status}).`,
        status,
        action,
      );
  }
}
