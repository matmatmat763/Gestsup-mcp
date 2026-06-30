import { z } from "zod";

/**
 * Configuration du serveur MCP GestSup, lue depuis les variables d'environnement.
 * La clé d'API est un secret : elle ne doit jamais être journalisée.
 */
const ConfigSchema = z.object({
  /** Base de l'instance GestSup, sans /api/v1. Ex: https://support.exemple.fr */
  baseUrl: z.string().url(),
  /** Clé d'API GestSup (longue chaîne hexadécimale). */
  apiKey: z.string().min(1),
  /** Mode d'authentification : header X-API-KEY (défaut) ou HTTP Basic. */
  authMode: z.enum(["header", "basic"]).default("header"),
  /** Timeout des requêtes HTTP (ms). */
  timeoutMs: z.number().int().positive().default(15000),
  /** Auteur par défaut pour l'ajout de commentaires (tusers.id). */
  defaultUserId: z.number().int().positive().optional(),
  /** Kill-switch : si false, les opérations d'écriture sont refusées localement. */
  allowWrites: z.boolean().default(true),
  /** Test uniquement : désactive la vérification du certificat TLS (auto-signé local). */
  insecureTls: z.boolean().default(false),
  /** Ids des types considérés comme « incident » (cause obligatoire à la clôture). */
  incidentTypeIds: z.array(z.number().int().positive()).optional(),
  /** Racine du vault Obsidian (active les outils de documentation si défini). */
  vaultPath: z.string().min(1).optional(),
  /** Sous-dossier par défaut des notes générées dans le vault. */
  vaultDocsFolder: z.string().default("KB"),
  /** Kill-switch écriture pour le vault Obsidian. */
  vaultAllowWrites: z.boolean().default(true),
  /** Score minimal (0-100) pour juger un ticket « documentable ». */
  docQualityThreshold: z.number().int().min(0).max(100).default(60),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = (env.GESTSUP_BASE_URL ?? "").trim().replace(/\/+$/, "");

  const cfg = ConfigSchema.parse({
    baseUrl,
    apiKey: (env.GESTSUP_API_KEY ?? "").trim(),
    authMode: (env.GESTSUP_AUTH_MODE ?? "header").trim(),
    timeoutMs: env.GESTSUP_TIMEOUT_MS ? Number(env.GESTSUP_TIMEOUT_MS) : 15000,
    defaultUserId: env.GESTSUP_DEFAULT_USER_ID
      ? Number(env.GESTSUP_DEFAULT_USER_ID)
      : undefined,
    allowWrites: env.GESTSUP_ALLOW_WRITES
      ? env.GESTSUP_ALLOW_WRITES.toLowerCase() !== "false"
      : true,
    insecureTls: env.GESTSUP_INSECURE_TLS
      ? env.GESTSUP_INSECURE_TLS.toLowerCase() === "true"
      : false,
    incidentTypeIds: env.GESTSUP_INCIDENT_TYPE_IDS
      ? env.GESTSUP_INCIDENT_TYPE_IDS.split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n) && n > 0)
      : undefined,
    vaultPath: env.OBSIDIAN_VAULT_PATH?.trim() || undefined,
    vaultDocsFolder: (env.OBSIDIAN_DOCS_FOLDER ?? "KB").trim() || "KB",
    vaultAllowWrites: env.OBSIDIAN_ALLOW_WRITES
      ? env.OBSIDIAN_ALLOW_WRITES.toLowerCase() !== "false"
      : true,
    docQualityThreshold: env.GESTSUP_DOC_QUALITY_THRESHOLD
      ? Number(env.GESTSUP_DOC_QUALITY_THRESHOLD)
      : 60,
  });

  // L'API GestSup refuse tout ce qui n'est pas le port 443 : on impose HTTPS.
  if (!cfg.baseUrl.startsWith("https://")) {
    throw new Error(
      "GESTSUP_BASE_URL doit commencer par https:// (l'API GestSup n'accepte que le port 443).",
    );
  }

  // Garde-fou : ne JAMAIS désactiver la vérification TLS vers un hôte public
  // (risque de MITM). Réservé au test local (localhost / IP privée / *.local).
  if (cfg.insecureTls && !isPrivateHost(new URL(cfg.baseUrl).hostname)) {
    throw new Error(
      "GESTSUP_INSECURE_TLS=true est refusé pour un hôte public (risque MITM). " +
        "Réservé à localhost / réseau privé / .local (ex. Docker auto-signé).",
    );
  }

  return cfg;
}

/** Hôte « local/privé » : localhost, .local, ou plage IP privée (RFC 1918). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".local") || h.endsWith(".localhost")) return true;
  if (!h.includes(".")) return true; // nom d'hôte court (réseau interne)
  // IPv4 privées : 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}
