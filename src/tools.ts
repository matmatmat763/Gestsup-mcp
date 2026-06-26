import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { GestsupError } from "./errors.js";
import type { GestsupClient, ReferentialKind } from "./gestsupClient.js";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(text: string, data?: unknown): ToolResult {
  const payload = data !== undefined ? `${text}\n\n${JSON.stringify(data, null, 2)}` : text;
  return { content: [{ type: "text", text: payload }] };
}

function fail(e: unknown): ToolResult {
  const msg = e instanceof GestsupError ? e.message : `Erreur inattendue : ${(e as Error).message}`;
  return { content: [{ type: "text", text: msg }], isError: true };
}

/** Enregistre tous les outils GestSup sur le serveur MCP. */
export function registerTools(server: McpServer, client: GestsupClient, cfg: Config): void {
  // ----------------------------------------------------------- create ticket
  server.registerTool(
    "gestsup_create_ticket",
    {
      title: "Créer un ticket",
      description:
        "Crée un nouveau ticket de support dans GestSup. Renvoie l'identifiant et l'URL du ticket créé.",
      inputSchema: {
        title: z.string().min(1).max(100).describe("Titre / sujet du ticket (≤ 100 caractères)."),
        description: z.string().min(1).describe("Description détaillée du problème."),
        type_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID du type de ticket (voir gestsup_list_referential kind=type)."),
        requester_email: z
          .string()
          .email()
          .optional()
          .describe("Email du demandeur ; rattache le ticket à l'utilisateur correspondant."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      try {
        const r = await client.createTicket({
          title: args.title,
          description: args.description,
          type_id: args.type_id,
          requester_email: args.requester_email,
        });
        return ok(`Ticket ${r.ticket_id} créé.`, r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // -------------------------------------------------------------- get ticket
  server.registerTool(
    "gestsup_get_ticket",
    {
      title: "Consulter un ticket",
      description:
        "Récupère un ticket GestSup par son numéro, avec son fil de résolution (commentaires, changements d'état, etc.).",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const t = await client.getTicket(args.ticket_id);
        return ok(
          `Ticket ${t.ticket_id} — « ${t.title} » (état: ${t.state_name}, ${t.resolution.length} élément(s) de résolution).`,
          t,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ----------------------------------------------------------- add comment
  server.registerTool(
    "gestsup_add_ticket_comment",
    {
      title: "Ajouter un commentaire",
      description:
        "Ajoute un commentaire (texte) au fil de résolution d'un ticket existant. Le ticket est vérifié avant l'ajout.",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        text: z.string().min(1).describe("Texte du commentaire."),
        user_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID de l'auteur (tusers.id). Défaut : GESTSUP_DEFAULT_USER_ID."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      const userId = args.user_id ?? cfg.defaultUserId;
      if (!userId) {
        return fail(
          new GestsupError(
            "Aucun user_id fourni et GESTSUP_DEFAULT_USER_ID non défini : impossible d'identifier l'auteur du commentaire.",
          ),
        );
      }
      try {
        // L'API ne vérifie pas l'existence du ticket : on le fait pour éviter un commentaire orphelin.
        await client.getTicket(args.ticket_id);
        const r = await client.addResolution(args.ticket_id, userId, args.text);
        return ok(`Commentaire ajouté au ticket ${r.ticket_id}.`, r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ------------------------------------------------------ find tickets by user
  server.registerTool(
    "gestsup_find_tickets_by_user",
    {
      title: "Lister les tickets d'un demandeur",
      description:
        "Liste les tickets d'un demandeur (par son ID), avec tri et pagination. Renvoie une liste vide si aucun ticket.",
      inputSchema: {
        user_id: z.number().int().positive().describe("ID du demandeur (tusers.id)."),
        order: z
          .enum(["id", "date_create", "date_modif"])
          .default("date_create")
          .describe("Critère de tri."),
        sort: z.enum(["ASC", "DESC"]).default("DESC").describe("Sens du tri."),
        limit: z.number().int().positive().max(200).default(20).describe("Nombre de tickets par page."),
        page: z.number().int().min(0).default(0).describe("Numéro de page (0 = première page)."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const list = await client.findTicketsByUser({
          user_id: args.user_id,
          order: args.order,
          sort: args.sort,
          limit: args.limit,
          page: args.page,
        });
        return ok(`${list.length} ticket(s) trouvé(s) pour l'utilisateur ${args.user_id}.`, list);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------------------------------------------------------------- get user
  server.registerTool(
    "gestsup_get_user",
    {
      title: "Consulter un utilisateur",
      description: "Récupère la fiche d'un utilisateur GestSup par son ID.",
      inputSchema: {
        user_id: z.number().int().positive().describe("ID de l'utilisateur."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const u = await client.getUser(args.user_id);
        return ok(`Utilisateur ${u.user_id} : ${u.firstname} ${u.lastname} <${u.mail}>.`, u);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // -------------------------------- recherche de tickets (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_search_tickets",
    {
      title: "Rechercher des tickets",
      description:
        "Recherche/liste des tickets avec filtres (technicien, état, catégorie, demandeur, mots-clés, dates), tri et pagination. Permet notamment de lister les tickets d'un TECHNICIEN. Nécessite le plugin serveur GestSup « gestsup_mcp » installé et activé.",
      inputSchema: {
        technician_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID du technicien assigné (pour lister SES tickets)."),
        state_id: z.number().int().nonnegative().optional().describe("ID d'état du ticket."),
        category_id: z.number().int().positive().optional().describe("ID de catégorie."),
        subcat_id: z.number().int().positive().optional().describe("ID de sous-catégorie."),
        requester_id: z.number().int().positive().optional().describe("ID du demandeur."),
        keywords: z.string().optional().describe("Recherche dans le titre et la description."),
        date_from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date de création minimale (YYYY-MM-DD)."),
        date_to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date de création maximale (YYYY-MM-DD)."),
        order: z
          .enum(["id", "date_create", "date_modif", "state", "priority"])
          .default("date_create")
          .describe("Critère de tri."),
        sort: z.enum(["ASC", "DESC"]).default("DESC").describe("Sens du tri."),
        limit: z.number().int().positive().max(200).default(50).describe("Tickets par page (max 200)."),
        page: z.number().int().min(0).default(0).describe("Numéro de page (0 = première)."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const r = await client.searchTickets({
          technician_id: args.technician_id,
          state_id: args.state_id,
          category_id: args.category_id,
          subcat_id: args.subcat_id,
          requester_id: args.requester_id,
          keywords: args.keywords,
          date_from: args.date_from,
          date_to: args.date_to,
          order: args.order,
          sort: args.sort,
          limit: args.limit,
          page: args.page,
        });
        return ok(
          `${r.count} ticket(s) affiché(s) sur ${r.total} au total (page ${args.page}).`,
          r,
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ------------------------------------------------------------ référentiels
  server.registerTool(
    "gestsup_list_referential",
    {
      title: "Lister un référentiel",
      description:
        "Liste un référentiel de tickets : types, catégories, sous-catégories ou lieux. Utile pour récupérer les ID nécessaires à la création de tickets.",
      inputSchema: {
        kind: z
          .enum(["type", "category", "subcat", "place"])
          .describe("Référentiel à lister."),
      },
    },
    async (args): Promise<ToolResult> => {
      try {
        const items = await client.listReferential(args.kind as ReferentialKind);
        return ok(`${items.length} entrée(s) dans le référentiel « ${args.kind} ».`, items);
      } catch (e) {
        return fail(e);
      }
    },
  );
}
