import type { Config } from "./config.js";
import { GestsupError, mapError } from "./errors.js";
import {
  isSuccess,
  normalizeTicket,
  normalizeTicketSummary,
  type Ticket,
  type TicketSummary,
} from "./normalize.js";

type Json = Record<string, unknown> | unknown[] | null;

export type ReferentialKind = "type" | "category" | "subcat" | "place";

export interface ReferentialItem {
  id: string;
  name: string;
  /** Pour les sous-catégories : id de la catégorie parente. */
  category_id?: string;
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

  private async call(
    method: string,
    path: string,
    opts: {
      query?: Record<string, string | number>;
      form?: Record<string, string | number | undefined>;
    } = {},
  ): Promise<{ status: number; ok: boolean; body: Json }> {
    const url = new URL(this.cfg.baseUrl + "/api/v1" + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const headers = this.authHeaders();
    let body: FormData | undefined;
    if (opts.form) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(opts.form)) {
        if (v !== undefined && v !== "") fd.append(k, String(v));
      }
      body = fd;
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
        throw new GestsupError(
          `Réponse non-JSON de GestSup (HTTP ${res.status}). Vérifiez l'URL de base et le routage /api/v1.`,
          res.status,
        );
      }
    }
    return { status: res.status, ok: res.ok, body: parsed };
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
    const pathByKind: Record<ReferentialKind, string> = {
      type: "/ticket/type/",
      category: "/ticket/category/",
      subcat: "/ticket/subcat/",
      place: "/ticket/place/",
    };
    const { status, body } = await this.call("GET", pathByKind[kind]);
    if (!Array.isArray(body)) {
      if (body && !isSuccess(body)) throw mapError(status, body, "Referential");
      return [];
    }
    return body.map((raw) => {
      const r = raw as Record<string, unknown>;
      switch (kind) {
        case "type":
          return { id: String(r.type_id ?? ""), name: String(r.type_name ?? "") };
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
      }
    });
  }
}
