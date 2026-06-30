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

  // ------------------------------ création complète (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_create_ticket_full",
    {
      title: "Créer un ticket (complet)",
      description:
        "Crée un ticket complet (demandeur, catégorie, sous-catégorie, priorité, criticité, type, titre, description, temps, technicien/groupe, lieu). " +
        "RECOMMANDÉ quand on part d'un email/d'une demande : 1) appeler gestsup_list_referential (type, category, subcat, priority, place…) pour connaître les valeurs RÉELLES de l'instance ; 2) DÉDUIRE du contenu les meilleurs ids (type incident/demande, catégorie, priorité, lieu/site) ; 3) confirmer avec l'utilisateur ; 4) créer. " +
        "Les valeurs de liste sont des IDs (jamais devinés/inventés). Le demandeur est donné par requester_id OU requester_email. " +
        "La création peut être REFUSÉE si des champs obligatoires définis dans GestSup manquent (le message indique lesquels). Notifie selon les paramètres GestSup. Nécessite le plugin « gestsup_mcp ».",
      inputSchema: {
        title: z.string().min(1).describe("Titre du ticket."),
        description: z.string().min(1).describe("Description."),
        requester_id: z.number().int().positive().optional().describe("ID du demandeur (tusers)."),
        requester_email: z.string().email().optional().describe("Email du demandeur (résolu en utilisateur)."),
        type_id: z.number().int().positive().optional().describe("ID de type (kind=type)."),
        category_id: z.number().int().positive().optional().describe("ID de catégorie (kind=category)."),
        subcat_id: z.number().int().positive().optional().describe("ID de sous-catégorie (kind=subcat)."),
        priority_id: z.number().int().positive().optional().describe("ID de priorité (kind=priority)."),
        criticality_id: z.number().int().positive().optional().describe("ID de criticité (kind=criticality)."),
        place_id: z.number().int().positive().optional().describe("ID de lieu (kind=place)."),
        technician_id: z.number().int().positive().optional().describe("Technicien assigné (kind=technician)."),
        group_id: z.number().int().positive().optional().describe("Groupe assigné (kind=group)."),
        time: z.number().int().nonnegative().optional().describe("Temps passé (minutes)."),
        time_hope: z.number().int().nonnegative().optional().describe("Temps prévu (minutes)."),
        date_hope: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Échéance souhaitée (YYYY-MM-DD)."),
        notify: z.boolean().default(true).describe("Notifier (nouveau ticket) selon paramètres GestSup."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      try {
        const r = await client.createTicketFull({
          title: args.title,
          description: args.description,
          requester_id: args.requester_id,
          requester_email: args.requester_email,
          type_id: args.type_id,
          category_id: args.category_id,
          subcat_id: args.subcat_id,
          priority_id: args.priority_id,
          criticality_id: args.criticality_id,
          place_id: args.place_id,
          technician_id: args.technician_id,
          group_id: args.group_id,
          time: args.time,
          time_hope: args.time_hope,
          date_hope: args.date_hope,
          notify: args.notify,
        });
        return ok(`Ticket ${r.ticket_id} créé (état ${r.state}, mail: ${r.mail}).`, r);
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
        "Ajoute un commentaire au fil d'un ticket. Un commentaire PUBLIC notifie le demandeur par mail (selon les paramètres GestSup) ; une NOTE INTERNE (internal=true) n'est pas visible du demandeur et n'envoie aucun mail. Nécessite le plugin serveur « gestsup_mcp ».",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        text: z.string().min(1).describe("Texte du commentaire."),
        internal: z
          .boolean()
          .default(false)
          .describe("true = note interne (privée, invisible du demandeur, sans mail)."),
        notify: z
          .boolean()
          .default(true)
          .describe("Pour un commentaire public : notifier le demandeur (par défaut oui)."),
        time: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Temps passé à enregistrer sur ce commentaire (minutes)."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      try {
        const r = await client.addComment({
          ticket_id: args.ticket_id,
          text: args.text,
          isPrivate: args.internal,
          time: args.time,
          notify: args.notify,
        });
        const kind = r.isPrivate ? "Note interne" : "Commentaire";
        const mail = r.isPrivate
          ? "sans notification"
          : r.notified
            ? `notification: ${r.mail}`
            : "sans notification";
        return ok(`${kind} ajouté(e) au ticket ${args.ticket_id} (${mail}).`, r);
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

  // --------------------------------- clôture conforme (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_close_ticket",
    {
      title: "Clôturer un ticket (conforme)",
      description:
        "Clôture un ticket selon son type : un INCIDENT exige la CAUSE ET la RÉSOLUTION ; une DEMANDE exige au moins la RÉSOLUTION. La clôture est REFUSÉE si une obligation manque. La cause (si fournie) est ajoutée à la fin de la description du ticket ; la résolution est consignée. Résout le ticket et notifie le demandeur. Nécessite le plugin « gestsup_mcp ».",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        resolution: z
          .string()
          .min(1)
          .describe("Résolution : ce qui a permis de résoudre. Obligatoire (incident ET demande)."),
        cause: z
          .string()
          .optional()
          .describe("Cause (ajoutée en fin de description). Obligatoire pour un incident."),
        procedure_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID d'une procédure GestSup (kind=procedure), optionnel."),
        procedure_text: z
          .string()
          .optional()
          .describe("Procédure en texte libre, optionnel."),
        time: z.number().int().nonnegative().optional().describe("Temps passé (minutes)."),
        notify: z.boolean().default(true).describe("Notifier le demandeur de la clôture."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      try {
        const r = await client.closeTicket({
          ticket_id: args.ticket_id,
          resolution: args.resolution,
          cause: args.cause,
          procedure_id: args.procedure_id,
          procedure_text: args.procedure_text,
          time: args.time,
          notify: args.notify,
        });
        const causeMsg = r.cause_appended
          ? "cause ajoutée en description"
          : r.cause_required
            ? "cause requise"
            : "sans cause";
        return ok(`Ticket ${args.ticket_id} clôturé (type ${r.ticket_type}, ${causeMsg}, mail: ${r.mail}).`, r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // -------------------------- mise à jour de champs (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_update_ticket",
    {
      title: "Mettre à jour un ticket",
      description:
        "Met à jour des champs d'un ticket : catégorie, sous-catégorie, priorité, criticité, type, temps passé/prévu. Les valeurs sont des IDs À RÉCUPÉRER via gestsup_list_referential (category/subcat/priority/criticality/type) — jamais devinés. Notifie le demandeur selon les paramètres GestSup. Nécessite le plugin « gestsup_mcp ».",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        category_id: z.number().int().positive().optional().describe("ID de catégorie (kind=category)."),
        subcat_id: z.number().int().positive().optional().describe("ID de sous-catégorie (kind=subcat)."),
        priority_id: z.number().int().positive().optional().describe("ID de priorité (kind=priority)."),
        criticality_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID de criticité (kind=criticality)."),
        type_id: z.number().int().positive().optional().describe("ID de type (kind=type)."),
        place_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID de lieu / site (kind=place) — utile en multi-site."),
        time: z.number().int().nonnegative().optional().describe("Temps passé total (minutes)."),
        time_hope: z.number().int().nonnegative().optional().describe("Temps prévu (minutes)."),
        notify: z.boolean().default(true).describe("Notifier le demandeur (selon paramètres GestSup)."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      const hasField =
        args.category_id !== undefined ||
        args.subcat_id !== undefined ||
        args.priority_id !== undefined ||
        args.criticality_id !== undefined ||
        args.type_id !== undefined ||
        args.place_id !== undefined ||
        args.time !== undefined ||
        args.time_hope !== undefined;
      if (!hasField) {
        return fail(new GestsupError("Aucun champ fourni à mettre à jour."));
      }
      try {
        const r = await client.updateTicket({
          ticket_id: args.ticket_id,
          category_id: args.category_id,
          subcat_id: args.subcat_id,
          priority_id: args.priority_id,
          criticality_id: args.criticality_id,
          type_id: args.type_id,
          place_id: args.place_id,
          time: args.time,
          time_hope: args.time_hope,
          notify: args.notify,
        });
        return ok(`Ticket ${args.ticket_id} mis à jour (mail: ${r.mail}).`, r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------------------------------------- affectation (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_assign_ticket",
    {
      title: "Affecter un ticket",
      description:
        "Affecte un ticket à un technicien OU à un groupe de techniciens. Fournir technician_id (voir gestsup_list_referential kind=technician) OU group_id (kind=group) — ids de l'instance, jamais devinés. Notifie le technicien/groupe affecté (paramètres GestSup). Nécessite le plugin « gestsup_mcp ».",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        technician_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID du technicien à affecter (exclusif avec group_id)."),
        group_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID du groupe de techniciens à affecter (exclusif avec technician_id)."),
        notify: z.boolean().default(true).describe("Notifier l'affectation (selon paramètres GestSup)."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      if (!args.technician_id && !args.group_id) {
        return fail(new GestsupError("Préciser technician_id ou group_id."));
      }
      try {
        const r = await client.assign({
          ticket_id: args.ticket_id,
          technician_id: args.technician_id,
          group_id: args.group_id,
          notify: args.notify,
        });
        const cible =
          r.assigned_to === "technician" ? `technicien ${r.technician}` : `groupe ${r.group}`;
        return ok(`Ticket ${args.ticket_id} affecté au ${cible} (${r.history}, mail: ${r.mail}).`, r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ----------------------------------- changement d'état (plugin gestsup_mcp)
  server.registerTool(
    "gestsup_set_ticket_state",
    {
      title: "Changer l'état d'un ticket",
      description:
        "Change l'état d'un ticket (ex. résoudre, rejeter, mettre en cours…). L'état est un ID À RÉCUPÉRER via gestsup_list_referential kind=state (jamais deviné). Passer à l'état résolu enregistre la date de résolution. Notifie le demandeur selon les paramètres GestSup. Nécessite le plugin « gestsup_mcp ».",
      inputSchema: {
        ticket_id: z.number().int().positive().describe("Numéro du ticket."),
        state_id: z
          .number()
          .int()
          .nonnegative()
          .describe("ID de l'état cible (voir gestsup_list_referential kind=state)."),
        comment: z
          .string()
          .optional()
          .describe("Commentaire/résolution à joindre au changement d'état."),
        internal: z
          .boolean()
          .default(false)
          .describe("true = le commentaire joint est une note interne (privée)."),
        time: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Temps passé à enregistrer (minutes)."),
        notify: z.boolean().default(true).describe("Notifier le demandeur (selon paramètres GestSup)."),
      },
    },
    async (args): Promise<ToolResult> => {
      if (!cfg.allowWrites) {
        return fail(new GestsupError("Écriture désactivée (GESTSUP_ALLOW_WRITES=false)."));
      }
      try {
        const r = await client.setState({
          ticket_id: args.ticket_id,
          state_id: args.state_id,
          text: args.comment,
          isPrivate: args.internal,
          time: args.time,
          notify: args.notify,
        });
        const verb = r.resolved ? "résolu" : `passé à « ${r.state_name} »`;
        return ok(`Ticket ${args.ticket_id} ${verb} (notification: ${r.mail}).`, r);
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
        exclude_state_ids: z
          .array(z.number().int().nonnegative())
          .optional()
          .describe(
            "États à exclure (ex. résolus) pour ne voir que les tickets ouverts. Récupérer les ids via gestsup_list_referential kind=state.",
          ),
        category_id: z.number().int().positive().optional().describe("ID de catégorie."),
        subcat_id: z.number().int().positive().optional().describe("ID de sous-catégorie."),
        type_id: z.number().int().positive().optional().describe("ID de type (kind=type)."),
        place_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID de lieu / site (kind=place) — utile en multi-site."),
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
          exclude_state_ids: args.exclude_state_ids,
          category_id: args.category_id,
          subcat_id: args.subcat_id,
          type_id: args.type_id,
          place_id: args.place_id,
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
        "Liste un référentiel défini par l'instance GestSup : types, catégories, sous-catégories, lieux, états, priorités, criticités ou causes de résolution. Récupère les ID/valeurs RÉELS de l'instance (jamais codés en dur). À utiliser avant de créer/mettre à jour un ticket. (états/priorités/criticités/causes nécessitent le plugin « gestsup_mcp ».)",
      inputSchema: {
        kind: z
          .enum([
            "type",
            "category",
            "subcat",
            "place",
            "state",
            "priority",
            "criticality",
            "cause",
            "group",
            "technician",
            "procedure",
          ])
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
