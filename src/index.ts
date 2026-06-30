#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GestsupClient } from "./gestsupClient.js";
import { registerTools } from "./tools.js";
import { VaultStore } from "./vault/store.js";

async function main(): Promise<void> {
  const cfg = (() => {
    try {
      return loadConfig();
    } catch (e) {
      console.error(`[gestsup-mcp] Configuration invalide : ${(e as Error).message}`);
      process.exit(1);
    }
  })();

  if (cfg.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    console.error(
      "[gestsup-mcp] ⚠️  Vérification TLS DÉSACTIVÉE (GESTSUP_INSECURE_TLS) — à n'utiliser qu'en test local.",
    );
  }

  const client = new GestsupClient(cfg);

  // Le module de documentation Obsidian n'est activé que si un vault est
  // configuré (sinon les déploiements GestSup-only restent inchangés).
  const vault = cfg.vaultPath
    ? new VaultStore({
        root: cfg.vaultPath,
        docsFolder: cfg.vaultDocsFolder,
        allowWrites: cfg.vaultAllowWrites,
      })
    : undefined;
  if (vault) {
    console.error(
      `[gestsup-mcp] Documentation Obsidian activée (vault: ${cfg.vaultPath}, dossier: ${cfg.vaultDocsFolder}/, écriture: ${cfg.vaultAllowWrites ? "oui" : "non"}).`,
    );
  }

  const server = new McpServer({ name: "gestsup-mcp", version: "0.1.0" });
  registerTools(server, client, cfg, vault);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Les logs vont sur stderr pour ne pas polluer le canal stdio du protocole.
  console.error("[gestsup-mcp] Serveur MCP GestSup prêt (transport stdio).");
}

main().catch((e) => {
  console.error("[gestsup-mcp] Erreur fatale :", e);
  process.exit(1);
});
