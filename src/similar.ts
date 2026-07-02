import type { Ticket, ThreadItem } from "./normalize.js";
import type { NoteContent } from "./vault/store.js";

/**
 * Détection de doublons : on compare un ticket à la documentation existante
 * pour savoir si un cas similaire — et SURTOUT avec la même résolution — est
 * déjà consigné. La mesure est lexicale, déterministe et explicable ; le LLM
 * tranche ensuite.
 */

const THREAD_COMMENT = "0";
const THREAD_CLOSURE = "4";

// Petite liste de mots vides (FR + génériques) pour ne garder que les termes
// porteurs de sens. Volontairement courte et non exhaustive.
const STOPWORDS = new Set([
  "les",
  "des",
  "une",
  "que",
  "qui",
  "quoi",
  "dont",
  "avec",
  "sans",
  "pour",
  "par",
  "sur",
  "sous",
  "dans",
  "est",
  "sont",
  "été",
  "être",
  "avoir",
  "cette",
  "ces",
  "son",
  "ses",
  "leur",
  "leurs",
  "nous",
  "vous",
  "ils",
  "elle",
  "elles",
  "mais",
  "donc",
  "car",
  "plus",
  "moins",
  "très",
  "pas",
  "ne",
  "le",
  "la",
  "un",
  "de",
  "du",
  "au",
  "aux",
  "et",
  "ou",
  "à",
  "en",
  "ce",
  "se",
  "il",
  "on",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "ticket",
  "gestsup",
]);

/** Découpe en termes significatifs (minuscules, sans accents, ≥ 3 lettres). */
export function tokenize(s: string): Set<string> {
  const norm = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const out = new Set<string>();
  for (const w of norm.split(/\s+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/** Couverture : part des termes de `a` présents dans `b` (0..1). */
export function coverage(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / a.size;
}

/** Texte de résolution d'un ticket (commentaires + clôture). */
export function resolutionText(threads: ThreadItem[]): string {
  return threads
    .filter((t) => t.thread_type_id === THREAD_COMMENT || t.thread_type_id === THREAD_CLOSURE)
    .map((t) => t.thread_text)
    .join(" ");
}

export interface SimilarNote {
  path: string;
  title: string;
  /** Part des termes du ticket (titre+description) couverts par la note. */
  relevance: number;
  /** Part des termes de la résolution du ticket couverts par la note. */
  resolutionOverlap: number;
  /** La note documente déjà CE ticket (frontmatter gestsup_ticket_id). */
  sameTicket: boolean;
}

export interface SimilarityResult {
  candidates: SimilarNote[];
  /** Meilleur doublon couvrant la même résolution (le cas échéant). */
  duplicate?: SimilarNote;
}

export interface SimilarityOptions {
  /** Seuil de pertinence (couverture des termes du problème). Défaut 0.4. */
  relevanceThreshold?: number;
  /** Seuil de recouvrement de la résolution. Défaut 0.5. */
  resolutionThreshold?: number;
  /** Nombre de candidats renvoyés. Défaut 5. */
  limit?: number;
}

export function findSimilarNotes(
  ticket: Ticket,
  notes: NoteContent[],
  opts: SimilarityOptions = {},
): SimilarityResult {
  const relTh = opts.relevanceThreshold ?? 0.4;
  const resTh = opts.resolutionThreshold ?? 0.5;
  const limit = opts.limit ?? 5;

  const problemTokens = tokenize(`${ticket.title} ${ticket.description}`);
  const resTokens = tokenize(resolutionText(ticket.resolution));

  const scored: SimilarNote[] = notes.map((n) => {
    const noteTokens = tokenize(`${n.title} ${n.body}`);
    const fmId = n.frontmatter.gestsup_ticket_id;
    const sameTicket = fmId !== undefined && String(fmId) === ticket.ticket_id;
    return {
      path: n.path,
      title: n.title,
      relevance: round(coverage(problemTokens, noteTokens)),
      resolutionOverlap: round(coverage(resTokens, noteTokens)),
      sameTicket,
    };
  });

  scored.sort((a, b) => {
    if (a.sameTicket !== b.sameTicket) return a.sameTicket ? -1 : 1;
    return b.relevance - a.relevance;
  });

  // Doublon : la note documente déjà ce ticket, OU elle est très pertinente ET
  // recouvre la même résolution.
  const duplicate = scored.find(
    (n) =>
      n.sameTicket || (n.relevance >= relTh && resTokens.size > 0 && n.resolutionOverlap >= resTh),
  );

  return { candidates: scored.slice(0, limit), duplicate };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
