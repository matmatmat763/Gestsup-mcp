import type { Ticket } from "./normalize.js";
import type { Frontmatter } from "./vault/frontmatter.js";

/** Types de thread GestSup porteurs de contenu de résolution. */
const THREAD_COMMENT = "0";
const THREAD_CLOSURE = "4";

/** Slug ASCII sûr pour un nom de fichier / tag. */
export function slugify(s: string, max = 60): string {
  const base = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (base || "note").slice(0, max).replace(/-+$/g, "");
}

export interface RenderedNote {
  /** Slug (sans dossier ni extension) proposé pour la note. */
  slug: string;
  frontmatter: Frontmatter;
  body: string;
}

/**
 * Rend un ticket GestSup sous forme d'article de knowledge base markdown
 * (frontmatter exploitable par Dataview + sections lisibles + lien retour).
 */
export function renderTicketNote(ticket: Ticket, baseUrl: string): RenderedNote {
  const slug = `ticket-${ticket.ticket_id}-${slugify(ticket.title)}`;
  const ticketUrl = `${baseUrl.replace(/\/+$/, "")}/index.php?page=ticket&id=${ticket.ticket_id}`;

  const tags = ["gestsup"];
  if (ticket.type_name) tags.push(slugify(ticket.type_name));

  const frontmatter: Frontmatter = {
    title: ticket.title || `Ticket ${ticket.ticket_id}`,
    tags,
    source: "gestsup",
    gestsup_ticket_id: Number(ticket.ticket_id) || 0,
    gestsup_type: ticket.type_name || "",
    gestsup_state: ticket.state_name || "",
  };

  const resThreads = ticket.resolution.filter(
    (t) => t.thread_type_id === THREAD_COMMENT || t.thread_type_id === THREAD_CLOSURE,
  );

  const parts: string[] = [];
  parts.push(`# ${ticket.title || `Ticket ${ticket.ticket_id}`}`);

  parts.push("## Problème");
  parts.push(ticket.description.trim() || "_(aucune description fournie)_");

  parts.push("## Contexte");
  const ctx: string[] = [];
  ctx.push(`- **Ticket** : #${ticket.ticket_id}`);
  if (ticket.type_name) ctx.push(`- **Type** : ${ticket.type_name}`);
  if (ticket.state_name) ctx.push(`- **État** : ${ticket.state_name}`);
  if (ticket.technician) ctx.push(`- **Technicien** : ${ticket.technician}`);
  if (ticket.date_create_fr || ticket.date_create) {
    ctx.push(`- **Créé le** : ${ticket.date_create_fr || ticket.date_create}`);
  }
  parts.push(ctx.join("\n"));

  parts.push("## Résolution");
  if (resThreads.length === 0) {
    parts.push("_(aucun élément de résolution consigné)_");
  } else {
    parts.push(
      resThreads
        .map((t) => {
          const meta = [t.thread_author, t.thread_date].filter(Boolean).join(" — ");
          const head = meta ? `**${meta}**` : "";
          const text = t.thread_text.trim();
          return [head, text].filter(Boolean).join("\n");
        })
        .join("\n\n"),
    );
  }

  parts.push("## Liens");
  parts.push(`- [Ouvrir le ticket dans GestSup](${ticketUrl})`);

  return { slug, frontmatter, body: parts.join("\n\n") };
}
