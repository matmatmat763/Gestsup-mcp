#!/usr/bin/env node
/**
 * Harnais d'intégration : exerce TOUS les endpoints d'écriture du plugin contre
 * une instance GestSup réelle et vérifie l'état en base (via relecture) + les
 * mails capturés (collecteur SMTP). Sert à revalider après une mise à jour de
 * GestSup (cf. docs/maintenance-gestsup-updates.md).
 *
 * Pré-requis : `npm run build` (utilise dist/), une instance GestSup avec le
 * plugin gestsup_mcp activé, et le collecteur smtpsink.py en marche.
 *
 * Config par variables d'env (défauts = stack docker/) :
 *   GESTSUP_BASE_URL (https://localhost:8443)  GESTSUP_API_KEY  GESTSUP_DEFAULT_USER_ID (10)
 *   GESTSUP_INSECURE_TLS (true)  REQUESTER_EMAIL (marie@demo.local)  TECH2_ID (11)
 *   RESOLVED_STATE (3)  SMTP_FILE (/tmp/smtp_caught.txt)
 */
import { readFileSync, existsSync } from "node:fs";
import { GestsupClient } from "../dist/gestsupClient.js";

const env = process.env;
const cfg = {
  baseUrl: env.GESTSUP_BASE_URL || "https://localhost:8443",
  apiKey: env.GESTSUP_API_KEY || "TESTKEY_local_dev_0123456789abcdef",
  authMode: "header",
  timeoutMs: 15000,
  allowWrites: true,
  insecureTls: (env.GESTSUP_INSECURE_TLS || "true").toLowerCase() === "true",
  defaultUserId: Number(env.GESTSUP_DEFAULT_USER_ID || 10),
};
if (cfg.insecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const REQUESTER_EMAIL = env.REQUESTER_EMAIL || "marie@demo.local";
const TECH2_ID = Number(env.TECH2_ID || 11);
const RESOLVED_STATE = Number(env.RESOLVED_STATE || 3);
const SMTP_FILE = env.SMTP_FILE || "/tmp/smtp_caught.txt";

const c = new GestsupClient(cfg);
let pass = 0;
let fail = 0;
function check(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra ? " — " + extra : ""}`);
  }
}
const mailCount = () =>
  existsSync(SMTP_FILE) ? (readFileSync(SMTP_FILE, "utf8").match(/=== MAIL ===/g) || []).length : 0;
const first = (arr) => (arr && arr.length ? arr[0].id : undefined);
const diff = (arr, exclude) => {
  const x = (arr || []).find((i) => Number(i.id) !== Number(exclude) && Number(i.id) !== RESOLVED_STATE);
  return x ? x.id : undefined;
};

async function main() {
  console.log(`# Harnais d'intégration GestSup MCP — ${cfg.baseUrl}\n`);

  // Référentiels (ids dynamiques de l'instance)
  const [types, cats, subcats, prios, crits, states] = await Promise.all([
    c.listReferential("type"),
    c.listReferential("category"),
    c.listReferential("subcat"),
    c.listReferential("priority"),
    c.listReferential("criticality"),
    c.listReferential("state"),
  ]);
  check("référentiels lus", types && cats && prios && states && states.length > 0);

  // 1) Création complète
  const created = await c.createTicketFull({
    title: "[IT] Ticket de test d'intégration",
    description: "Créé par run.mjs",
    requester_email: REQUESTER_EMAIL,
    type_id: Number(first(types)) || undefined,
    category_id: Number(first(cats)) || undefined,
    subcat_id: Number(first(subcats)) || undefined,
    priority_id: Number(first(prios)) || undefined,
    criticality_id: Number(first(crits)) || undefined,
    time_hope: 60,
    notify: false,
  });
  const id = Number(created.ticket_id);
  check("création ticket", id > 0, `ticket ${id}`);

  // 2) Commentaire public -> notifie le demandeur
  let before = mailCount();
  const pub = await c.addComment({ ticket_id: id, text: "Commentaire public IT", isPrivate: false });
  await sleep(800);
  check("commentaire public", !pub.isPrivate && pub.notified);
  check("mail demandeur (public)", mailCount() > before, `${mailCount() - before} mail(s)`);

  // 3) Note interne -> aucun mail
  before = mailCount();
  const note = await c.addComment({ ticket_id: id, text: "Note interne IT", isPrivate: true });
  await sleep(500);
  check("note interne privée", note.isPrivate === true);
  check("note interne sans mail", mailCount() === before);

  // 4) Affectation à un technicien
  const asg = await c.assign({ ticket_id: id, technician_id: TECH2_ID, notify: false });
  check("affectation", asg.technician === String(TECH2_ID) && asg.history !== "none", asg.history);

  // 5) Mise à jour de champs (priorité différente)
  const newPrio = diff(prios, first(prios));
  if (newPrio !== undefined) {
    const upd = await c.updateTicket({ ticket_id: id, priority_id: Number(newPrio), notify: false });
    check("mise à jour priorité", upd.updated && String(upd.updated.priority) === String(newPrio));
  }

  // 6) Changement d'état (état non résolu différent de l'actuel)
  const t = await c.getTicket(id);
  const newState = diff(states, t.state_id);
  if (newState !== undefined) {
    const st = await c.setState({ ticket_id: id, state_id: Number(newState), notify: false });
    check("changement d'état", st.new_state === String(newState), st.state_name);
  }

  // 7) Clôture conforme (cause ajoutée en fin de description)
  const cause = "Cause IT " + Date.now();
  const cl = await c.closeTicket({
    ticket_id: id,
    cause,
    procedure_text: "Procédure de test",
    resolution: "Résolu par IT",
    notify: false,
  });
  check("clôture conforme", cl.resolved === true);
  const closed = await c.getTicket(id);
  check("ticket résolu", String(closed.state_id) === String(RESOLVED_STATE), closed.state_name);
  check("cause en fin de description", closed.description.includes(cause));

  // 8) Refus de clôture non conforme
  try {
    await c.closeTicket({ ticket_id: id, cause: "", procedure_text: "x", notify: false });
    check("refus clôture non conforme", false, "aurait dû échouer");
  } catch (e) {
    check("refus clôture non conforme", /non conforme|déjà résolu/i.test(e.message), e.message.slice(0, 60));
  }

  console.log(`\n# Résultat : ${pass} PASS / ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main().catch((e) => {
  console.error("Erreur fatale du harnais :", e);
  process.exit(2);
});
