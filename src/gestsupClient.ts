import type { Config } from "./config.js";
import { GestsupError, mapError } from "./errors.js";
import {
  isSuccess,
  normalizeTicket,
  normalizeTicketListItem,
  normalizeTicketSummary,
  type Ticket,
  type TicketListItem,
  type TicketSummary,
} from "./normalize.js";

type Json = Record<string, unknown> | unknown[] | null;

/** Référentiels via l'API native. */
export type NativeReferentialKind = "type" | "category" | "subcat" | "place";
/** Référentiels via le plugin (définis par l'instance, lus en base). */
export type PluginReferentialKind =
  | "state"
  | "priority"
  | "criticality"
  | "cause"
  | "group"
  | "technician"
  | "procedure";
export type ReferentialKind = NativeReferentialKind | PluginReferentialKind;

export interface ReferentialItem {
  id: string;
  name: string;
  /** Pour les sous-catégories : id de la catégorie parente. */
  category_id?: string;
  /** Métadonnées éventuelles (états : number/meta/hidden ; priorités : color…). */
  [extra: string]: unknown;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  type_id?: number;
  requester_email?: string;
}

export interface FindTicketsInput {
  user_id: number;
  order: "id" | "date_create" | "date_modif";
  sort: "ASC" | "DESC";
  limit: number;
  /** Numéro de page (0 = première page). Mappé sur le paramètre `offset` de l'API. */
  page: number;
}

export interface SearchTicketsInput {
  technician_id?: number;
  state_id?: number;
  /** États à exclure (ex. résolus) — ids issus du référentiel de l'instance. */
  exclude_state_ids?: number[];
  category_id?: number;
  subcat_id?: number;
  type_id?: number;
  /** Lieu (multi-site) — id issu du référentiel `place`. */
  place_id?: number;
  requester_id?: number;
  keywords?: string;
  date_from?: string;
  date_to?: string;
  order: "id" | "date_create" | "date_modif" | "state" | "priority";
  sort: "ASC" | "DESC";
  limit: number;
  /** Numéro de page (0 = première). Converti en offset réel pour le plugin. */
  page: number;
}

export interface SearchTicketsResult {
  total: number;
  count: number;
  limit: number;
  offset: number;
  tickets: TicketListItem[];
}

export interface UserInfo {
  user_id: string;
  firstname: string;
  lastname: string;
  mail: string;
  phone: string;
  mobile: string;
  fax: string;
  function: string;
  profile: string;
}

/** Client bas niveau de l'API REST GestSup (api/v1). */
export class GestsupClient {
  private readonly cfg: Config;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: Config, fetchImpl: typeof fetch = fetch) {
    this.cfg = cfg;
    this.fetchImpl = fetchImpl;
  }

  private authHeaders(): Record<string, string> {
    if (this.cfg.authMode === "basic") {
      const b64 = Buffer.from(this.cfg.apiKey).toString("base64");
      return { Authorization: `Basic ${b64}` };
    }
    return { "X-API-KEY": this.cfg.apiKey };
  }

  /** Appel sur un chemin relatif à la racine de l'instance (hors /api/v1). */
  private async callAbsolute(
    method: string,
    subPath: string,
    opts: {
      query?: Record<string, string | number>;
      form?: Record<string, string | number | undefined>;
      urlencoded?: boolean;
    } = {},
  ): Promise<{ status: number; ok: boolean; body: Json }> {
    const url = new URL(this.cfg.baseUrl + subPath);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const headers = this.authHeaders();
    let body: FormData | URLSearchParams | undefined;
    if (opts.form) {
      if (opts.urlencoded) {
        const usp = new URLSearchParams();
        for (const [k, v] of Object.entries(opts.form)) {
          if (v !== undefined && v !== "") usp.append(k, String(v));
        }
        body = usp;
      } else {
        const fd = new FormData();
        for (const [k, v] of Object.entries(opts.form)) {
          if (v !== undefined && v !== "") fd.append(k, String(v));
        }
        body = fd;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (e) {
      throw new GestsupError(
        `Échec de la connexion à GestSup : ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed: Json = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as Json;
      } catch {
        // Une réponse 2xx non-JSON = mauvaise config (URL/routage). Sur une
        // réponse d'erreur (4xx/5xx), c'est souvent une page HTML d'Apache :
        // on laisse body=null et on se fie au statut côté appelant.
        if (res.ok) {
          throw new GestsupError(
            `Réponse non-JSON de GestSup (HTTP ${res.status}). Vérifiez l'URL de base et le routage /api/v1.`,
            res.status,
          );
        }
      }
    }
    return { status: res.status, ok: res.ok, body: parsed };
  }

  /** Appel sur l'API native /api/v1. */
  private call(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string | number>;
      form?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<{ status: number; ok: boolean; body: Json }> {
    return this.callAbsolute(method, "/api/v1" + path, opts);
  }

  // ----------------------------------------------------------------- Tickets

  async createTicket(
    input: CreateTicketInput,
  ): Promise<{ ticket_id: string; ticket_url: string; message: string }> {
    const { status, body } = await this.call("POST", "/ticket/", {
      form: {
        ticket_title: input.title,
        ticket_description: input.description,
        ticket_type: input.type_id,
        ticket_user_mail: input.requester_email,
      },
    });
    if (!isSuccess(body)) throw mapError(status, body, "TicketAdd");
    const b = body as Record<string, unknown>;
    return {
      ticket_id: String(b.ticket_id ?? ""),
      ticket_url: String(b.ticket_url ?? ""),
      message: String(b.message ?? ""),
    };
  }

  /**
   * Création complète d'un ticket via le plugin (demandeur, catégorie, priorité,
   * type, temps, technicien…). Valeurs de liste validées contre l'instance.
   */
  async createTicketFull(input: {
    title: string;
    description: string;
    requester_id?: number;
    requester_email?: string;
    type_id?: number;
    category_id?: number;
    subcat_id?: number;
    priority_id?: number;
    criticality_id?: number;
    place_id?: number;
    technician_id?: number;
    group_id?: number;
    time?: number;
    time_hope?: number;
    date_hope?: string;
    state_id?: number;
    notify?: boolean;
  }): Promise<{ ticket_id: string; ticket_url: string; user: string; state: string; mail: string }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError("GESTSUP_DEFAULT_USER_ID est requis (créateur du ticket).");
    }
    const { status, body } = await this.callAbsolute("POST", "/plugins/gestsup_mcp/ticket_create.php", {
      urlencoded: true,
      form: {
        author_id: this.cfg.defaultUserId,
        title: input.title,
        description: input.description,
        requester_id: input.requester_id,
        requester_email: input.requester_email,
        type: input.type_id,
        category: input.category_id,
        subcat: input.subcat_id,
        priority: input.priority_id,
        criticality: input.criticality_id,
        place: input.place_id,
        technician_id: input.technician_id,
        group_id: input.group_id,
        time: input.time,
        time_hope: input.time_hope,
        date_hope: input.date_hope,
        state: input.state_id,
        notify: input.notify === false ? 0 : 1,
      },
    });
    if (status === 404 && !(body && typeof body === "object" && "ticket_id" in body)) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404). Plugin « gestsup_mcp » installé ?",
        404,
        "TicketCreate",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketCreate");
    const b = body as Record<string, unknown>;
    return {
      ticket_id: String(b.ticket_id ?? ""),
      ticket_url: String(b.ticket_url ?? ""),
      user: String(b.user ?? ""),
      state: String(b.state ?? ""),
      mail: String(b.mail ?? ""),
    };
  }

  async getTicket(id: number): Promise<Ticket> {
    const { status, body } = await this.call("GET", `/ticket/${id}`);
    if (!isSuccess(body)) {
      if (status === 404) throw new GestsupError(`Ticket ${id} introuvable.`, 404, "TicketGet");
      throw mapError(status, body, "TicketGet");
    }
    return normalizeTicket(body as Record<string, unknown>);
  }

  async addResolution(
    ticketId: number,
    userId: number,
    text: string,
  ): Promise<{ ticket_id: string; ticket_url: string; message: string }> {
    const { status, body } = await this.call("POST", `/ticket/${ticketId}/resolution`, {
      form: { user_id: userId, text },
    });
    if (!isSuccess(body)) throw mapError(status, body, "TicketAddResolution");
    const b = body as Record<string, unknown>;
    return {
      ticket_id: String(b.ticket_id ?? ""),
      ticket_url: String(b.ticket_url ?? ""),
      message: String(b.message ?? ""),
    };
  }

  async findTicketsByUser(input: FindTicketsInput): Promise<TicketSummary[]> {
    const { status, body } = await this.call("GET", "/ticket/findByUser", {
      query: {
        user_id: input.user_id,
        order: input.order,
        sort: input.sort,
        limit: input.limit,
        offset: input.page, // l'API multiplie offset par limit => offset = n° de page
      },
    });

    if (Array.isArray(body)) {
      return body.map((t) => normalizeTicketSummary(t as Record<string, unknown>));
    }
    // 404 = "utilisateur introuvable" OU "aucun ticket". On distingue les deux.
    if (status === 404) {
      const msg =
        body && typeof body === "object" && "message" in body
          ? String((body as Record<string, unknown>).message ?? "")
          : "";
      if (/User not found/i.test(msg)) {
        throw new GestsupError(`Utilisateur ${input.user_id} introuvable.`, 404, "TicketsFindByUser");
      }
      return []; // aucun ticket => liste vide (plus naturel qu'une erreur)
    }
    throw mapError(status, body, "TicketsFindByUser");
  }

  // ------------------------------------------------------------------- Users

  async getUser(id: number): Promise<UserInfo> {
    const { status, body } = await this.call("GET", `/user/${id}`);
    if (!isSuccess(body)) {
      if (status === 404) throw new GestsupError(`Utilisateur ${id} introuvable.`, 404, "UserGet");
      throw mapError(status, body, "UserGet");
    }
    const b = body as Record<string, unknown>;
    const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    return {
      user_id: s(b.user_id),
      firstname: s(b.firstname),
      lastname: s(b.lastname),
      mail: s(b.mail),
      phone: s(b.phone),
      mobile: s(b.mobile),
      fax: s(b.fax),
      function: s(b.function),
      profile: s(b.profile),
    };
  }

  // ------------------------------------------------------------- Référentiels

  async listReferential(kind: ReferentialKind): Promise<ReferentialItem[]> {
    const nativePaths: Record<NativeReferentialKind, string> = {
      type: "/ticket/type/",
      category: "/ticket/category/",
      subcat: "/ticket/subcat/",
      place: "/ticket/place/",
    };

    // Référentiels exposés par l'API native
    if (Object.prototype.hasOwnProperty.call(nativePaths, kind)) {
      const { status, body } = await this.call("GET", nativePaths[kind as NativeReferentialKind]);
      if (!Array.isArray(body)) {
        if (body && !isSuccess(body)) throw mapError(status, body, "Referential");
        return [];
      }
      return body.map((raw) => {
        const r = raw as Record<string, unknown>;
        switch (kind) {
          case "category":
            return { id: String(r.category_id ?? ""), name: String(r.category_name ?? "") };
          case "place":
            return { id: String(r.place_id ?? ""), name: String(r.place_name ?? "") };
          case "subcat":
            return {
              id: String(r.subcat_id ?? ""),
              name: String(r.subcat_name ?? ""),
              category_id: String(r.category_id ?? ""),
            };
          default: // type
            return { id: String(r.type_id ?? ""), name: String(r.type_name ?? "") };
        }
      });
    }

    // Référentiels définis par l'instance (état/priorité/criticité/cause), via le plugin
    const { status, body } = await this.callAbsolute("GET", "/plugins/gestsup_mcp/referentials.php", {
      query: { kind },
    });
    if (status === 404) {
      throw new GestsupError(
        "Plugin gestsup_mcp non installé (référentiels étendus indisponibles).",
        404,
        "Referential",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "Referential");
    const items = Array.isArray((body as Record<string, unknown>).items)
      ? ((body as Record<string, unknown>).items as Record<string, unknown>[])
      : [];
    return items.map((r) => {
      const out: ReferentialItem = { id: String(r.id ?? ""), name: String(r.name ?? "") };
      for (const k of Object.keys(r)) {
        if (k !== "id" && k !== "name") out[k] = r[k];
      }
      return out;
    });
  }

  /**
   * Clôture conforme d'un ticket : exige une cause (ajoutée en fin de
   * description) et une procédure (id GestSup et/ou texte). Résout le ticket
   * (état résolu + date_res) et déclenche la notification native de clôture.
   */
  async closeTicket(input: {
    ticket_id: number;
    resolution: string;
    cause?: string;
    procedure_id?: number;
    procedure_text?: string;
    time?: number;
    notify?: boolean;
  }): Promise<{
    resolved: boolean;
    ticket_type: string;
    cause_required: boolean;
    cause_appended: boolean;
    procedure: string;
    mail: string;
  }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError("GESTSUP_DEFAULT_USER_ID est requis (auteur de l'action).");
    }
    const { status, body } = await this.callAbsolute("POST", "/plugins/gestsup_mcp/ticket_close.php", {
      urlencoded: true,
      form: {
        author_id: this.cfg.defaultUserId,
        ticket_id: input.ticket_id,
        resolution: input.resolution,
        cause: input.cause,
        procedure_id: input.procedure_id,
        procedure_text: input.procedure_text,
        time: input.time ?? 0,
        notify: input.notify === false ? 0 : 1,
        incident_type_ids:
          this.cfg.incidentTypeIds && this.cfg.incidentTypeIds.length
            ? this.cfg.incidentTypeIds.join(",")
            : undefined,
      },
    });
    if (status === 404 && !(body && typeof body === "object" && "resolved" in body)) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404) ou ticket inexistant. Plugin « gestsup_mcp » installé ?",
        404,
        "TicketClose",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketClose");
    const b = body as Record<string, unknown>;
    return {
      resolved: Boolean(b.resolved),
      ticket_type: String(b.ticket_type ?? ""),
      cause_required: Boolean(b.cause_required),
      cause_appended: Boolean(b.cause_appended),
      procedure: String(b.procedure ?? ""),
      mail: String(b.mail ?? ""),
    };
  }

  /**
   * Affecte un ticket à un technicien OU à un groupe (ids de l'instance).
   * Déclenche la notification d'attribution native de GestSup.
   */
  async assign(input: {
    ticket_id: number;
    technician_id?: number;
    group_id?: number;
    notify?: boolean;
  }): Promise<{
    assigned_to: string;
    technician: string;
    group: string;
    history: string;
    new_state: string;
    mail: string;
  }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError("GESTSUP_DEFAULT_USER_ID est requis (auteur de l'action).");
    }
    if (!input.technician_id && !input.group_id) {
      throw new GestsupError("Préciser technician_id ou group_id.");
    }
    const { status, body } = await this.callAbsolute("POST", "/plugins/gestsup_mcp/ticket_assign.php", {
      urlencoded: true,
      form: {
        author_id: this.cfg.defaultUserId,
        ticket_id: input.ticket_id,
        technician_id: input.technician_id,
        group_id: input.group_id,
        notify: input.notify === false ? 0 : 1,
      },
    });
    if (status === 404 && !(body && typeof body === "object" && "assigned_to" in body)) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404) ou ticket inexistant. Plugin « gestsup_mcp » installé ?",
        404,
        "TicketAssign",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketAssign");
    const b = body as Record<string, unknown>;
    return {
      assigned_to: String(b.assigned_to ?? ""),
      technician: String(b.technician ?? ""),
      group: String(b.group ?? ""),
      history: String(b.history ?? ""),
      new_state: String(b.new_state ?? ""),
      mail: String(b.mail ?? ""),
    };
  }

  /**
   * Change l'état d'un ticket via le plugin (résoudre, rejeter… l'état est un id
   * de la liste de l'instance). Déclenche la notification native de GestSup.
   */
  async setState(input: {
    ticket_id: number;
    state_id: number;
    text?: string;
    isPrivate?: boolean;
    time?: number;
    notify?: boolean;
  }): Promise<{
    old_state: string;
    new_state: string;
    state_name: string;
    resolved: boolean;
    comment: string;
    mail: string;
  }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError("GESTSUP_DEFAULT_USER_ID est requis (auteur de l'action).");
    }
    const { status, body } = await this.callAbsolute("POST", "/plugins/gestsup_mcp/ticket_state.php", {
      urlencoded: true,
      form: {
        author_id: this.cfg.defaultUserId,
        ticket_id: input.ticket_id,
        state_id: input.state_id,
        text: input.text,
        private: input.isPrivate ? 1 : 0,
        time: input.time ?? 0,
        notify: input.notify === false ? 0 : 1,
      },
    });
    if (status === 404 && !(body && typeof body === "object" && "new_state" in body)) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404) ou ticket inexistant. Plugin « gestsup_mcp » installé ?",
        404,
        "TicketState",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketState");
    const b = body as Record<string, unknown>;
    return {
      old_state: String(b.old_state ?? ""),
      new_state: String(b.new_state ?? ""),
      state_name: String(b.state_name ?? ""),
      resolved: Boolean(b.resolved),
      comment: String(b.comment ?? ""),
      mail: String(b.mail ?? ""),
    };
  }

  /**
   * Met à jour des champs simples d'un ticket (catégorie, sous-catégorie,
   * priorité, criticité, type, temps passé/prévu). Chaque id est validé côté
   * serveur contre la liste de l'instance. Déclenche la notification native.
   */
  async updateTicket(input: {
    ticket_id: number;
    category_id?: number;
    subcat_id?: number;
    priority_id?: number;
    criticality_id?: number;
    type_id?: number;
    place_id?: number;
    time?: number;
    time_hope?: number;
    notify?: boolean;
  }): Promise<{ updated: Record<string, unknown>; mail: string }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError("GESTSUP_DEFAULT_USER_ID est requis (auteur de l'action).");
    }
    const { status, body } = await this.callAbsolute("POST", "/plugins/gestsup_mcp/ticket_update.php", {
      urlencoded: true,
      form: {
        author_id: this.cfg.defaultUserId,
        ticket_id: input.ticket_id,
        category: input.category_id,
        subcat: input.subcat_id,
        priority: input.priority_id,
        criticality: input.criticality_id,
        type: input.type_id,
        place: input.place_id,
        time: input.time,
        time_hope: input.time_hope,
        notify: input.notify === false ? 0 : 1,
      },
    });
    if (status === 404 && !(body && typeof body === "object" && "updated" in body)) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404) ou ticket inexistant. Plugin « gestsup_mcp » installé ?",
        404,
        "TicketUpdate",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketUpdate");
    const b = body as Record<string, unknown>;
    return {
      updated: (b.updated as Record<string, unknown>) ?? {},
      mail: String(b.mail ?? ""),
    };
  }

  // ----------------------------- Plugin gestsup_mcp (API étendue, lecture) ---

  /**
   * Recherche/liste de tickets via le plugin serveur `gestsup_mcp`.
   * Requiert l'installation + activation du plugin sur l'instance GestSup.
   */
  async searchTickets(input: SearchTicketsInput): Promise<SearchTicketsResult> {
    const query: Record<string, string | number> = {
      order: input.order,
      sort: input.sort,
      limit: input.limit,
      offset: input.page * input.limit, // l'endpoint plugin attend un offset réel
    };
    if (input.technician_id !== undefined) query.technician = input.technician_id;
    if (input.state_id !== undefined) query.state = input.state_id;
    if (input.exclude_state_ids && input.exclude_state_ids.length > 0) {
      query.exclude_states = input.exclude_state_ids.join(",");
    }
    if (input.category_id !== undefined) query.category = input.category_id;
    if (input.subcat_id !== undefined) query.subcat = input.subcat_id;
    if (input.type_id !== undefined) query.type = input.type_id;
    if (input.place_id !== undefined) query.place = input.place_id;
    if (input.requester_id !== undefined) query.user = input.requester_id;
    if (input.keywords !== undefined && input.keywords !== "") query.keywords = input.keywords;
    if (input.date_from !== undefined) query.date_from = input.date_from;
    if (input.date_to !== undefined) query.date_to = input.date_to;

    const { status, body } = await this.callAbsolute(
      "GET",
      "/plugins/gestsup_mcp/tickets.php",
      { query },
    );

    if (status === 404) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404). Le plugin GestSup « gestsup_mcp » n'est probablement pas installé sur cette instance.",
        404,
        "TicketList",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketList");

    const b = body as Record<string, unknown>;
    const rows = Array.isArray(b.tickets) ? (b.tickets as Record<string, unknown>[]) : [];
    return {
      total: Number(b.total ?? rows.length),
      count: Number(b.count ?? rows.length),
      limit: Number(b.limit ?? input.limit),
      offset: Number(b.offset ?? 0),
      tickets: rows.map(normalizeTicketListItem),
    };
  }

  /**
   * Ajoute un commentaire (public ou interne) à un ticket via le plugin
   * gestsup_mcp. Un commentaire public déclenche la notification native de
   * GestSup (mail au demandeur) selon les paramètres de l'application.
   * L'auteur est le technicien configuré (GESTSUP_DEFAULT_USER_ID).
   */
  async addComment(input: {
    ticket_id: number;
    text: string;
    isPrivate: boolean;
    time?: number;
    notify?: boolean;
  }): Promise<{ thread_id: string; isPrivate: boolean; notified: boolean; mail: string }> {
    if (!this.cfg.defaultUserId) {
      throw new GestsupError(
        "GESTSUP_DEFAULT_USER_ID est requis pour identifier l'auteur du commentaire.",
      );
    }
    const { status, body } = await this.callAbsolute(
      "POST",
      "/plugins/gestsup_mcp/ticket_comment.php",
      {
        urlencoded: true,
        form: {
          author_id: this.cfg.defaultUserId,
          ticket_id: input.ticket_id,
          text: input.text,
          private: input.isPrivate ? 1 : 0,
          time: input.time ?? 0,
          notify: input.notify === false ? 0 : 1,
        },
      },
    );
    if (status === 404) {
      throw new GestsupError(
        "Endpoint plugin introuvable (404). Le plugin GestSup « gestsup_mcp » n'est probablement pas installé.",
        404,
        "TicketComment",
      );
    }
    if (!isSuccess(body)) throw mapError(status, body, "TicketComment");
    const b = body as Record<string, unknown>;
    return {
      thread_id: String(b.thread_id ?? ""),
      isPrivate: Number(b.private ?? 0) === 1,
      notified: Boolean(b.notified),
      mail: String(b.mail ?? ""),
    };
  }
}
