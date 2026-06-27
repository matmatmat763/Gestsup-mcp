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
  });

  // L'API GestSup refuse tout ce qui n'est pas le port 443 : on impose HTTPS.
  if (!cfg.baseUrl.startsWith("https://")) {
    throw new Error(
      "GESTSUP_BASE_URL doit commencer par https:// (l'API GestSup n'accepte que le port 443).",
    );
  }

  return cfg;
}
