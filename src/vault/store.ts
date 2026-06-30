import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import {
  Frontmatter,
  parseNote,
  stringifyNote,
} from "./frontmatter.js";

/** Erreur normalisée pour les opérations sur le vault. */
export class VaultError extends Error {
  readonly code: string;
  constructor(message: string, code = "VAULT_ERROR") {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export interface VaultOptions {
  /** Racine absolue du vault Obsidian (dossier contenant les .md). */
  root: string;
  /** Sous-dossier par défaut pour les notes générées (ex. "KB"). */
  docsFolder: string;
  /** Kill-switch écriture. */
  allowWrites: boolean;
  /** Nb max de fichiers parcourus lors d'un list/search (garde-fou). */
  maxScan?: number;
}

export interface NoteRef {
  /** Chemin relatif POSIX dans le vault, ex. "KB/imprimante.md". */
  path: string;
  /** Titre dérivé du frontmatter ou du nom de fichier. */
  title: string;
}

export interface NoteContent extends NoteRef {
  exists: boolean;
  frontmatter: Frontmatter;
  body: string;
}

export interface SearchHit extends NoteRef {
  /** Extrait autour de la première correspondance. */
  snippet: string;
  /** Champ ayant matché (title|tags|body). */
  matchedIn: "title" | "tags" | "body";
}

export type WriteMode = "create" | "overwrite";
export type AppendMode = "append" | "replace";

const IGNORED_DIRS = new Set([".obsidian", ".git", ".trash", "node_modules"]);

/**
 * Accès filesystem à un vault Obsidian. Aucune dépendance à l'app Obsidian :
 * on lit/écrit directement les fichiers markdown, ce qui rend l'intégration
 * compatible avec n'importe quel client MCP (Hermes, etc.).
 */
export class VaultStore {
  private readonly root: string;
  readonly docsFolder: string;
  readonly allowWrites: boolean;
  private readonly maxScan: number;

  constructor(opts: VaultOptions) {
    this.root = path.resolve(opts.root);
    this.docsFolder = opts.docsFolder.replace(/^\/+|\/+$/g, "");
    this.allowWrites = opts.allowWrites;
    this.maxScan = opts.maxScan ?? 5000;
  }

  // ------------------------------------------------------ accessibilité

  /** Code d'erreur réseau typique d'un partage (SMB/NFS) démonté/injoignable. */
  private static readonly NETWORK_CODES = new Set([
    "EIO", "ENOTCONN", "EHOSTDOWN", "EHOSTUNREACH", "ENETUNREACH",
    "ETIMEDOUT", "ECONNREFUSED", "ESTALE", "EBUSY",
  ]);

  /** Transforme une erreur filesystem en message lisible (partage réseau inclus). */
  private mapFsError(e: unknown, context: string): VaultError {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (code === "ENOENT") {
      return new VaultError(
        `Vault introuvable (« ${this.root} ») — le partage réseau est-il monté ? [${context}]`,
        "UNREACHABLE",
      );
    }
    if (code === "ENOTDIR") {
      return new VaultError(`Le chemin du vault n'est pas un dossier (« ${this.root} »). [${context}]`, "BAD_ROOT");
    }
    if (code === "EACCES" || code === "EPERM") {
      return new VaultError(`Accès refusé au vault (« ${this.root} ») — vérifiez les droits du montage. [${context}]`, "ACCESS");
    }
    if (VaultStore.NETWORK_CODES.has(code)) {
      return new VaultError(
        `Vault injoignable (« ${this.root} », ${code}) — le serveur de fichiers/partage répond-il ? [${context}]`,
        "UNREACHABLE",
      );
    }
    return new VaultError(`Erreur d'accès au vault (${code || "inconnue"}) : ${(e as Error).message}. [${context}]`);
  }

  /** Vérifie que la racine du vault est joignable (et un dossier). */
  private async ensureReachable(context: string): Promise<void> {
    try {
      const st = await fs.stat(this.root);
      if (!st.isDirectory()) {
        throw new VaultError(`Le chemin du vault n'est pas un dossier (« ${this.root} »). [${context}]`, "BAD_ROOT");
      }
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw this.mapFsError(e, context);
    }
  }

  /**
   * Contrôle de santé au démarrage : le vault est-il accessible (et écrivable
   * si les écritures sont activées) ? Renvoie un diagnostic au lieu de lever,
   * pour permettre au serveur de démarrer même si le partage est momentanément
   * indisponible.
   */
  async healthCheck(): Promise<{ ok: boolean; writable: boolean; message: string }> {
    try {
      await this.ensureReachable("healthCheck");
    } catch (e) {
      return { ok: false, writable: false, message: (e as VaultError).message };
    }
    let writable = false;
    if (this.allowWrites) {
      try {
        await fs.access(this.root, fsConstants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }
    const message = this.allowWrites
      ? writable
        ? `Vault accessible et écrivable (« ${this.root} »).`
        : `Vault accessible mais NON écrivable (« ${this.root} ») — vérifiez les droits du montage.`
      : `Vault accessible en lecture seule (« ${this.root} »).`;
    return { ok: true, writable, message };
  }

  // --------------------------------------------------------------- chemins

  /**
   * Résout un chemin relatif fourni par l'appelant en chemin absolu DANS le
   * vault. Refuse toute évasion (`..`, chemin absolu) — anti path-traversal.
   * Normalise l'extension `.md`.
   */
  private resolveInside(rel: string): { abs: string; rel: string } {
    if (typeof rel !== "string" || rel.trim() === "") {
      throw new VaultError("Chemin de note vide.", "BAD_PATH");
    }
    let p = rel.trim().replace(/\\/g, "/");
    if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) {
      throw new VaultError("Le chemin doit être relatif au vault.", "BAD_PATH");
    }
    if (!/\.md$/i.test(p)) p += ".md";
    const abs = path.resolve(this.root, p);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new VaultError("Chemin hors du vault (évasion refusée).", "ESCAPE");
    }
    return { abs, rel: path.relative(this.root, abs).split(path.sep).join("/") };
  }

  /** Construit un chemin de note dans le dossier docs, à partir d'un slug. */
  docPath(slug: string): string {
    const clean = slug
      .replace(/\.md$/i, "")
      .replace(/[\/\\]+/g, "-");
    const base = this.docsFolder ? `${this.docsFolder}/${clean}` : clean;
    return `${base}.md`;
  }

  private titleOf(fm: Frontmatter, rel: string): string {
    const t = fm.title;
    if (typeof t === "string" && t.trim() !== "") return t;
    const base = rel.split("/").pop() ?? rel;
    return base.replace(/\.md$/i, "");
  }

  private assertWritable(): void {
    if (!this.allowWrites) {
      throw new VaultError(
        "Écriture du vault désactivée (OBSIDIAN_ALLOW_WRITES=false).",
        "READONLY",
      );
    }
  }

  // ----------------------------------------------------------- parcours

  /** Résout un sous-dossier en absolu DANS le vault (anti path-traversal). */
  private resolveDir(subdir: string): string {
    const clean = subdir.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (clean === "" || clean === ".") return this.root;
    if (path.isAbsolute(clean) || /^[a-zA-Z]:/.test(clean)) {
      throw new VaultError("Le dossier doit être relatif au vault.", "BAD_PATH");
    }
    const abs = path.resolve(this.root, clean);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (abs !== this.root && !abs.startsWith(rootWithSep)) {
      throw new VaultError("Dossier hors du vault (évasion refusée).", "ESCAPE");
    }
    return abs;
  }

  /** Liste récursive des chemins .md (relatifs POSIX), bornée par maxScan. */
  private async walk(subdir = ""): Promise<string[]> {
    const out: string[] = [];
    const start = this.resolveDir(subdir);
    const stack: string[] = [start];
    let first = true;
    while (stack.length > 0 && out.length < this.maxScan) {
      const dir = stack.pop() as string;
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e) {
        // Échec sur le dossier de départ = vault/partage injoignable : on
        // remonte une erreur claire. Sur un sous-dossier, on tolère et continue.
        if (first) throw this.mapFsError(e, "walk");
        continue;
      } finally {
        first = false;
      }
      for (const e of entries) {
        if (out.length >= this.maxScan) break;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith(".")) stack.push(full);
        } else if (e.isFile() && /\.md$/i.test(e.name)) {
          out.push(path.relative(this.root, full).split(path.sep).join("/"));
        }
      }
    }
    return out.sort();
  }

  // -------------------------------------------------------------- API

  async listNotes(opts: { folder?: string; query?: string; limit?: number } = {}): Promise<NoteRef[]> {
    const all = await this.walk(opts.folder ?? "");
    const q = opts.query?.toLowerCase();
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const refs: NoteRef[] = [];
    for (const rel of all) {
      if (q && !rel.toLowerCase().includes(q)) continue;
      refs.push({ path: rel, title: rel.split("/").pop()!.replace(/\.md$/i, "") });
      if (refs.length >= limit) break;
    }
    return refs;
  }

  /** Lit en lot le contenu des notes (borné par maxScan) — pour la similarité. */
  async readMany(opts: { folder?: string; limit?: number } = {}): Promise<NoteContent[]> {
    const all = await this.walk(opts.folder ?? "");
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), this.maxScan);
    const out: NoteContent[] = [];
    for (const rel of all) {
      if (out.length >= limit) break;
      try {
        const raw = await fs.readFile(path.resolve(this.root, rel), "utf8");
        const { frontmatter, body } = parseNote(raw);
        out.push({ path: rel, title: this.titleOf(frontmatter, rel), exists: true, frontmatter, body });
      } catch {
        // note illisible : ignorée
      }
    }
    return out;
  }

  async readNote(notePath: string): Promise<NoteContent> {
    const { abs, rel } = this.resolveInside(notePath);
    // Le vault doit être joignable : ainsi un ENOENT ci-dessous signifie bien
    // « note absente » et non « partage démonté ».
    await this.ensureReachable("readNote");
    try {
      const raw = await fs.readFile(abs, "utf8");
      const { frontmatter, body } = parseNote(raw);
      return { path: rel, title: this.titleOf(frontmatter, rel), exists: true, frontmatter, body };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return { path: rel, title: rel.split("/").pop()!.replace(/\.md$/i, ""), exists: false, frontmatter: {}, body: "" };
      }
      throw this.mapFsError(e, "readNote");
    }
  }

  async search(opts: { query: string; folder?: string; limit?: number }): Promise<SearchHit[]> {
    const q = opts.query.trim().toLowerCase();
    if (q === "") throw new VaultError("Requête de recherche vide.", "BAD_QUERY");
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const all = await this.walk(opts.folder ?? "");
    const hits: SearchHit[] = [];
    for (const rel of all) {
      if (hits.length >= limit) break;
      let raw: string;
      try {
        raw = await fs.readFile(path.resolve(this.root, rel), "utf8");
      } catch {
        continue;
      }
      const { frontmatter, body } = parseNote(raw);
      const title = this.titleOf(frontmatter, rel);
      const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.join(" ") : String(frontmatter.tags ?? "");
      let matchedIn: SearchHit["matchedIn"] | null = null;
      if (title.toLowerCase().includes(q)) matchedIn = "title";
      else if (tags.toLowerCase().includes(q)) matchedIn = "tags";
      else if (body.toLowerCase().includes(q)) matchedIn = "body";
      if (!matchedIn) continue;
      hits.push({ path: rel, title, matchedIn, snippet: snippetAround(matchedIn === "body" ? body : `${title} ${tags}`, q) });
    }
    return hits;
  }

  async writeNote(opts: {
    path: string;
    body: string;
    frontmatter?: Frontmatter;
    mode?: WriteMode;
  }): Promise<{ path: string; created: boolean }> {
    this.assertWritable();
    const { abs, rel } = this.resolveInside(opts.path);
    await this.ensureReachable("writeNote");
    const mode: WriteMode = opts.mode ?? "create";
    const existed = await fileExists(abs);
    if (existed && mode === "create") {
      throw new VaultError(
        `La note « ${rel} » existe déjà (utilisez mode "overwrite" pour la remplacer).`,
        "EXISTS",
      );
    }
    const now = today();
    const fm: Frontmatter = { ...(opts.frontmatter ?? {}) };
    if (!existed && fm.created === undefined) fm.created = now;
    fm.updated = now;
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, stringifyNote(fm, opts.body), "utf8");
    } catch (e) {
      throw this.mapFsError(e, "writeNote");
    }
    return { path: rel, created: !existed };
  }

  /**
   * Ajoute (ou remplace) une section sous un titre `## <heading>`. Crée la note
   * si elle n'existe pas. Flux « compléter la doc au fil du temps ».
   */
  async appendSection(opts: {
    path: string;
    heading: string;
    content: string;
    mode?: AppendMode;
    frontmatterIfNew?: Frontmatter;
  }): Promise<{ path: string; created: boolean; sectionReplaced: boolean }> {
    this.assertWritable();
    const heading = opts.heading.trim();
    if (heading === "") throw new VaultError("Titre de section vide.", "BAD_HEADING");
    const existing = await this.readNote(opts.path);
    const mode: AppendMode = opts.mode ?? "append";

    const fm: Frontmatter = existing.exists
      ? { ...existing.frontmatter }
      : { ...(opts.frontmatterIfNew ?? {}) };

    const sec = upsertSection(existing.body, heading, opts.content.trim(), mode);
    const res = await this.writeNote({
      path: opts.path,
      body: sec.body,
      frontmatter: fm,
      mode: existing.exists ? "overwrite" : "create",
    });
    return { path: res.path, created: !existing.exists, sectionReplaced: sec.replaced };
  }
}

function snippetAround(text: string, q: string, radius = 80): string {
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

/**
 * Insère ou remplace une section `## heading`. En mode append, ajoute le
 * contenu à la fin de la section existante (ou crée la section). En mode
 * replace, remplace le corps de la section.
 */
function upsertSection(
  body: string,
  heading: string,
  content: string,
  mode: AppendMode,
): { body: string; replaced: boolean } {
  const lines = body.split("\n");
  const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "i");
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    // Section absente : on l'ajoute en fin de note.
    const prefix = body.trim() === "" ? "" : `${body.replace(/\s+$/, "")}\n\n`;
    return { body: `${prefix}## ${heading}\n\n${content}\n`, replaced: false };
  }
  // Trouve la fin de la section (prochain titre de niveau <= courant).
  const level = (lines[startIdx].match(/^#+/) ?? ["#"])[0].length;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) {
      endIdx = i;
      break;
    }
  }
  const sectionBody = lines.slice(startIdx + 1, endIdx);
  let newSection: string[];
  let replaced = false;
  if (mode === "replace") {
    newSection = ["", content, ""];
    replaced = true;
  } else {
    const trimmed = sectionBody.join("\n").replace(/\s+$/, "");
    newSection = trimmed === "" ? ["", content, ""] : ["", trimmed, "", content, ""];
  }
  const out = [...lines.slice(0, startIdx + 1), ...newSection, ...lines.slice(endIdx)];
  return { body: out.join("\n"), replaced };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
