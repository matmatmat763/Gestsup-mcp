#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { GestsupClient } from "./gestsupClient.js";
import { registerTools } from "./tools.js";

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
  const server = new McpServer({ name: "gestsup-mcp", version: "0.1.0" });
  registerTools(server, client, cfg);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Les logs vont sur stderr pour ne pas polluer le canal stdio du protocole.
  console.error("[gestsup-mcp] Serveur MCP GestSup prêt (transport stdio).");
}

main().catch((e) => {
  console.error("[gestsup-mcp] Erreur fatale :", e);
  process.exit(1);
});
