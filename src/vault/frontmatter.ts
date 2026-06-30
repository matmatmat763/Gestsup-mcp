/**
 * Frontmatter YAML minimal pour les notes Obsidian.
 *
 * On ne dépend pas d'une bibliothèque YAML : nos notes n'utilisent que des
 * valeurs simples (chaînes, nombres, booléens, listes de chaînes plates), ce
 * qui couvre les besoins d'un knowledge base GestSup et garde le serveur sans
 * dépendance supplémentaire. Les cas YAML exotiques (imbrication, ancres…) ne
 * sont volontairement pas gérés.
 */

export type FrontmatterValue = string | number | boolean | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

const FENCE = "---";

/** Échappe une chaîne pour un scalaire YAML (guillemets si nécessaire). */
function quoteIfNeeded(s: string): string {
  // Guillemets si la chaîne contient des caractères qui casseraient le parse,
  // ou si elle pourrait être réinterprétée (nombre, booléen, vide…).
  if (
    s === "" ||
    /[:#\[\]{}",&*!|>'%@`]/.test(s) ||
    /^\s|\s$/.test(s) ||
    /^(true|false|null|yes|no|~)$/i.test(s) ||
    /^[-+]?\d/.test(s)
  ) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function serializeValue(v: FrontmatterValue): string {
  if (Array.isArray(v)) {
    return `[${v.map((x) => quoteIfNeeded(String(x))).join(", ")}]`;
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  return quoteIfNeeded(v);
}

/** Sérialise un objet frontmatter en bloc `--- ... ---` (sans corps). */
export function serializeFrontmatter(fm: Frontmatter): string {
  const keys = Object.keys(fm);
  if (keys.length === 0) return "";
  const lines = keys.map((k) => `${k}: ${serializeValue(fm[k])}`);
  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n`;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
  }
  return t;
}

function parseScalar(raw: string): FrontmatterValue {
  const t = raw.trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    // Découpe sur les virgules de premier niveau (pas d'imbrication gérée).
    return splitTopLevel(inner).map((x) => unquote(x));
  }
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (/^[-+]?\d+$/.test(t)) {
    const n = Number(t);
    if (Number.isSafeInteger(n)) return n;
  }
  return unquote(t);
}

/** Découpe une liste inline en respectant les guillemets. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string;
}

/** Sépare le frontmatter (si présent) du corps d'une note markdown. */
export function parseNote(content: string): ParsedNote {
  // Tolère un BOM / des fins de ligne Windows.
  const text = content.replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) {
    return { frontmatter: {}, body: text };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    // Pas de fence fermante : on ne traite pas comme du frontmatter.
    return { frontmatter: {}, body: text };
  }
  const fm: Frontmatter = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key === "") continue;
    fm[key] = parseScalar(line.slice(idx + 1));
  }
  const body = lines.slice(end + 1).join("\n");
  return { frontmatter: fm, body: body.replace(/^\n+/, "") };
}

/** Recompose une note (frontmatter + corps). */
export function stringifyNote(fm: Frontmatter, body: string): string {
  const head = serializeFrontmatter(fm);
  const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
  if (head === "") return `${trimmedBody}\n`;
  return `${head}\n${trimmedBody}\n`;
}
