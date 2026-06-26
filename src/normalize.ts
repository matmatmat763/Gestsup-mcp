/**
 * Normalisation des réponses GestSup : l'API encode les textes via
 * htmlspecialchars(ENT_QUOTES) et mélange chaînes/entiers pour code/type.
 * Ces helpers rendent les données propres pour un agent LLM.
 */

/** Décode les entités HTML produites par htmlspecialchars(ENT_QUOTES). */
export function decodeHtml(input: unknown): string {
  if (input === null || input === undefined) return "";
  const s = String(input);
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&"); // &amp; décodé en dernier
}

/** Vrai si la réponse GestSup indique un succès (code 0 / type success, string OU int). */
export function isSuccess(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  const codeOk = b.code !== undefined && Number(b.code) === 0;
  const typeOk = typeof b.type === "string" && b.type.toLowerCase() === "success";
  return codeOk || typeOk;
}

export interface Ticket {
  ticket_id: string;
  technician: string;
  type_id: string;
  type_name: string;
  title: string;
  description: string;
  date_create: string;
  date_create_fr: string;
  state_id: string;
  state_name: string;
  resolution: ThreadItem[];
}

export interface ThreadItem {
  thread_id: string;
  thread_type_id: string;
  thread_type_name: string;
  thread_state_name?: string;
  thread_date: string;
  thread_author: string;
  thread_text: string;
}

export interface TicketSummary {
  ticket_id: string;
  subject: string;
  state_id: string;
  state_name: string;
  date_create: string;
  date_modif: string;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function normalizeTicket(body: Record<string, unknown>): Ticket {
  const resolution = Array.isArray(body.ticket_resolution)
    ? (body.ticket_resolution as Record<string, unknown>[]).map(normalizeThread)
    : [];
  return {
    ticket_id: str(body.ticket_id),
    technician: decodeHtml(body.ticket_technician),
    type_id: str(body.ticket_type_id),
    type_name: decodeHtml(body.ticket_type_name),
    title: decodeHtml(body.ticket_title),
    description: decodeHtml(body.ticket_description),
    date_create: str(body.ticket_date_create),
    date_create_fr: str(body.ticket_date_create_fr),
    state_id: str(body.ticket_state_id),
    state_name: decodeHtml(body.ticket_state_name),
    resolution,
  };
}

function normalizeThread(t: Record<string, unknown>): ThreadItem {
  const item: ThreadItem = {
    thread_id: str(t.thread_id),
    thread_type_id: str(t.thread_type_id),
    thread_type_name: str(t.thread_type_name),
    thread_date: str(t.thread_date),
    thread_author: decodeHtml(t.thread_author),
    thread_text: decodeHtml(t.thread_text),
  };
  if (t.thread_state_name !== undefined && t.thread_state_name !== "") {
    item.thread_state_name = decodeHtml(t.thread_state_name);
  }
  return item;
}

export function normalizeTicketSummary(t: Record<string, unknown>): TicketSummary {
  return {
    ticket_id: str(t.ticket_id),
    subject: decodeHtml(t.ticket_subject),
    state_id: str(t.ticket_state_id),
    state_name: decodeHtml(t.ticket_state_name),
    date_create: str(t.ticket_date_create),
    date_modif: str(t.ticket_date_modif),
  };
}
