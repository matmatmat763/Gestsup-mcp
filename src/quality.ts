import type { Ticket, ThreadItem } from "./normalize.js";

/**
 * Évaluation déterministe de la « richesse » d'un ticket en vue de le
 * documenter dans un knowledge base. La heuristique est volontairement simple
 * et reproductible : elle produit un score, des signaux et une liste de
 * manques, et laisse le LLM (Hermes ou autre) trancher l'usage.
 *
 * Aucune valeur métier n'est codée en dur côté GestSup : les seuils ci-dessous
 * concernent la qualité rédactionnelle, pas la configuration de l'instance.
 */

/** Types de thread GestSup porteurs de contenu de résolution. */
const THREAD_COMMENT = "0";
const THREAD_CLOSURE = "4";

export interface QualitySignal {
  key: string;
  label: string;
  ok: boolean;
  /** Poids dans le score (somme des poids = 100). */
  weight: number;
  detail?: string;
}

export interface QualityReport {
  ticket_id: string;
  title: string;
  score: number;
  threshold: number;
  documentable: boolean;
  signals: QualitySignal[];
  /** Ce qu'il manque pour rendre le ticket documentable (libellés courts). */
  missing: string[];
  /** Résumé lisible. */
  summary: string;
}

const MIN_DESCRIPTION_LEN = 40;
const MIN_RESOLUTION_LEN = 30;

function textLen(s: string): number {
  return s.replace(/\s+/g, " ").trim().length;
}

/** Concatène le texte des threads porteurs de résolution (commentaires + clôture). */
function resolutionThreads(threads: ThreadItem[]): ThreadItem[] {
  return threads.filter(
    (t) => t.thread_type_id === THREAD_COMMENT || t.thread_type_id === THREAD_CLOSURE,
  );
}

export function assessTicketQuality(ticket: Ticket, threshold: number): QualityReport {
  const descLen = textLen(ticket.description);
  const resThreads = resolutionThreads(ticket.resolution);
  const resText = resThreads.map((t) => t.thread_text).join(" ");
  const resLen = textLen(resText);
  const hasClosure = ticket.resolution.some((t) => t.thread_type_id === THREAD_CLOSURE);
  const typeDefined = ticket.type_id !== "" && ticket.type_id !== "0";

  const signals: QualitySignal[] = [
    {
      key: "description",
      label: "Description suffisamment détaillée",
      ok: descLen >= MIN_DESCRIPTION_LEN,
      weight: 30,
      detail: `${descLen} caractères (seuil ${MIN_DESCRIPTION_LEN}).`,
    },
    {
      key: "resolution",
      label: "Résolution / commentaires consignés",
      ok: resLen >= MIN_RESOLUTION_LEN,
      weight: 35,
      detail: `${resThreads.length} élément(s), ${resLen} caractères de contenu.`,
    },
    {
      key: "closed",
      label: "Ticket clôturé (résolution actée)",
      ok: hasClosure,
      weight: 15,
      detail: hasClosure ? "Présence d'un thread de clôture." : "Aucune clôture détectée.",
    },
    {
      key: "type",
      label: "Type de demande défini",
      ok: typeDefined,
      weight: 10,
      detail: typeDefined ? `Type « ${ticket.type_name || ticket.type_id} ».` : "Type non défini.",
    },
    {
      key: "title",
      label: "Titre explicite",
      ok: textLen(ticket.title) >= 8,
      weight: 10,
      detail: `${textLen(ticket.title)} caractères.`,
    },
  ];

  const score = signals.reduce((acc, s) => acc + (s.ok ? s.weight : 0), 0);
  const documentable = score >= threshold;
  const missing = signals.filter((s) => !s.ok).map((s) => s.label);

  const summary = documentable
    ? `Ticket ${ticket.ticket_id} documentable (score ${score}/100 ≥ ${threshold}).`
    : `Ticket ${ticket.ticket_id} pauvre en information (score ${score}/100 < ${threshold}). Manques : ${
        missing.join(" ; ") || "—"
      }.`;

  return {
    ticket_id: ticket.ticket_id,
    title: ticket.title,
    score,
    threshold,
    documentable,
    signals,
    missing,
    summary,
  };
}
