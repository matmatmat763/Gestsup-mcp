# GestSup MCP

Serveur **MCP (Model Context Protocol)** pour piloter les **tickets GestSup**
depuis un agent LLM (Claude Desktop, etc.), accompagné d'un **plugin serveur
GestSup** qui ajoute les endpoints manquants (recherche + écritures) et d'une
**documentation de l'API REST GestSup**.

## Sommaire

| Élément | Description |
|---|---|
| **Serveur MCP** (`src/`) | Outils de gestion de tickets (lecture + écriture) à brancher sur un client MCP. |
| [`docs/guide-demarrage.md`](docs/guide-demarrage.md) | **Guide de démarrage** : brancher GestSup + vault Obsidian (local ou serveur SMB/NFS) sur Hermes/Claude. |
| **Plugin GestSup** ([`plugin/gestsup_mcp/`](plugin/gestsup_mcp/)) | Addon serveur (PHP) : endpoints de recherche et d'écriture, qui répliquent la logique native et réutilisent le mailer natif. |
| [`docs/gestsup-api.md`](docs/gestsup-api.md) | Documentation de l'API REST GestSup native, reconstruite depuis le code source. |
| [`docs/maintenance-gestsup-updates.md`](docs/maintenance-gestsup-updates.md) | **Runbook** : mettre à jour le plugin/MCP quand GestSup évolue. |
| [`test-integration/`](test-integration/) | Harnais de revalidation bout-en-bout (endpoints + mails) contre une instance réelle. |
| [`docker/`](docker/) | Instance GestSup jetable (données d'exemple, plugin auto-installé) pour tester. |
| [`docs/reference/swagger-v1-3.2.55.json`](docs/reference/swagger-v1-3.2.55.json) | Swagger d'origine de GestSup (incomplet, fourni pour référence). |

## Outils MCP exposés

🔌 = nécessite le plugin serveur `gestsup_mcp` installé et activé.

### Lecture
| Outil | Rôle | |
|---|---|---|
| `gestsup_get_ticket` | Lire un ticket + son fil de résolution | natif |
| `gestsup_find_tickets_by_user` | Lister les tickets d'un demandeur (tri + pagination) | natif |
| `gestsup_get_user` | Lire la fiche d'un utilisateur | natif |
| `gestsup_list_referential` | Listes de l'instance : type/catégorie/sous-cat/lieu (natif) ; état/priorité/criticité/cause/groupe/technicien/procédure (🔌) | natif + 🔌 |
| `gestsup_search_tickets` | Rechercher des tickets (technicien, état, catégorie, mots-clés, dates, exclusion d'états) | 🔌 |

### Écriture
| Outil | Rôle | |
|---|---|---|
| `gestsup_create_ticket` | Créer un ticket simple (titre, description, type, email demandeur) | natif |
| `gestsup_create_ticket_full` | Créer un ticket complet (demandeur, catégorie, priorité, type, temps, technicien…) | 🔌 |
| `gestsup_add_ticket_comment` | Ajouter un commentaire public (mail au demandeur) ou une note interne (sans mail) | 🔌 |
| `gestsup_set_ticket_state` | Changer l'état (résoudre, rejeter, en cours…) | 🔌 |
| `gestsup_assign_ticket` | Affecter à un technicien ou un groupe | 🔌 |
| `gestsup_update_ticket` | Mettre à jour catégorie / sous-cat / priorité / criticité / type / temps | 🔌 |
| `gestsup_close_ticket` | Clôture **conforme** (cause + procédure obligatoires) | 🔌 |

Toutes les écritures **répliquent la logique native** de GestSup et **réutilisent
son mailer** : les notifications partent exactement selon tes paramètres
(`mail_auto_*`). Aucune valeur de liste n'est codée en dur : les ids (états,
priorités, catégories, techniciens, procédures…) sont **lus de ton instance** et
validés. L'identité de l'acteur = `GESTSUP_DEFAULT_USER_ID`.

### Documentation (Obsidian)

📓 = activé uniquement si un vault est configuré (`OBSIDIAN_VAULT_PATH`).

| Outil | Rôle | |
|---|---|---|
| `gestsup_assess_ticket_quality` | Évaluer si un ticket est **riche et propre** (score, signaux, manques) avant de le capitaliser | natif |
| `gestsup_suggest_documentation` | **Proposer** de documenter un ticket en fin de traitement, **sauf** si un cas similaire couvrant la même résolution existe déjà | 📓 |
| `obsidian_list_notes` | Lister les notes du vault (filtre dossier / nom) | 📓 |
| `obsidian_search` | Chercher dans la doc (titre, tags, corps) — *« a-t-on déjà eu ce problème ? »* | 📓 |
| `obsidian_read_note` | Lire une note (frontmatter + corps) | 📓 |
| `obsidian_write_note` | Créer / remplacer une note (idéal : doc issue d'une conversation) | 📓 |
| `obsidian_append_section` | Ajouter / remplacer une section `## …` (enrichir la doc au fil du temps) | 📓 |
| `gestsup_document_ticket` | Générer un **article KB** depuis un ticket (Problème / Contexte / Résolution / Liens) | 📓 |

L'accès au vault est **par fichiers** (lecture/écriture directe des `.md`) :
aucune dépendance à l'app Obsidian ni à un plugin tiers, donc **compatible avec
n'importe quel client MCP** (Hermes agent, Claude Desktop…). `gestsup_document_ticket`
**avertit** si le ticket est jugé pauvre (verdict + manques) mais documente
quand même si demandé — c'est au LLM de décider. Anti path-traversal, écrasement
jamais silencieux (mode explicite), kill-switch `OBSIDIAN_ALLOW_WRITES`.

**Vault sur un serveur de fichiers (SMB/NFS…).** Comme l'accès est par fichiers,
il suffit de **monter** le partage sur la machine du MCP et de pointer
`OBSIDIAN_VAULT_PATH` sur le dossier monté (aucun client SMB embarqué, donc rien
de fragile). Au démarrage, le serveur **vérifie que le vault est joignable** et
le signale ; si le partage est démonté, les outils de doc renvoient un message
clair (« vault injoignable — partage monté ? ») sans planter les outils GestSup.
Procédure de montage (Linux/macOS/Windows) dans le [guide de démarrage](docs/guide-demarrage.md).

**Recherche dans les deux sens.** De la doc vers la solution : `obsidian_search`
retrouve un problème/solution déjà consigné. Du ticket vers la doc :
`gestsup_suggest_documentation` (et la réponse de `gestsup_close_ticket` quand un
vault est configuré) **propose de documenter en fin de ticket**, mais détecte
d'abord si un **cas similaire avec la même résolution** est déjà en doc — auquel
cas il invite à ne pas créer de doublon (ou à compléter la note existante). La
détection de similarité est lexicale, déterministe et explicable ; le LLM tranche.

## Scénarios d'assistant (exemples)

Une fois branché, tu pilotes GestSup en langage naturel ; l'assistant combine les
outils :

- **Point quotidien sur mes tickets** : *« Fais le point sur mes tickets ouverts »*
  → `gestsup_search_tickets(technician_id=<moi>, exclude_state_ids=[<résolu/rejeté>])`
  puis synthèse (les ids d'états viennent de `gestsup_list_referential kind=state`).
- **Résumé d'un ticket** : *« Résume le ticket 1234 »* → `gestsup_get_ticket`.
- **Tickets d'un demandeur** : *« Où en sont les tickets de Marie ? »*
  → `gestsup_find_tickets_by_user` / `gestsup_search_tickets(requester_id=…)`.
- **« Point infra » d'équipe** : `gestsup_search_tickets` filtré par technicien(s)/groupe.
- **Agir** : commenter, noter en interne, changer l'état/résoudre, affecter,
  mettre à jour (catégorie/priorité/temps), clôturer (conforme), créer un ticket.
- **Chercher une solution dans la doc** : *« A-t-on déjà eu ce souci d'imprimante ? »*
  → `obsidian_search` (puis `obsidian_read_note` pour la fiche complète).
- **Capitaliser depuis un ticket** : *« Le ticket 1234 mérite-t-il d'être documenté ? »*
  → `gestsup_assess_ticket_quality` ; si oui, *« Documente-le »* → `gestsup_document_ticket`
  (article KB dans le vault). L'outil **prévient** si le ticket est trop pauvre.
- **Proposition en fin de ticket (anti-doublon)** : après une clôture,
  `gestsup_suggest_documentation` (ou directement la réponse de `gestsup_close_ticket`)
  propose de documenter — *sauf* si un cas similaire avec la même résolution est
  déjà en doc, où il invite à compléter la note existante plutôt qu'à en créer une.
- **Documenter une conversation** : *« Note dans la doc la procédure d'accès VPN »*
  → `obsidian_write_note` / `obsidian_append_section` (sans ticket source).
- **Enrichir au fil du temps** : *« Ajoute à la note imprimante le cas du toner Lyon »*
  → `obsidian_append_section(path, heading, content)`.

## Compatibilité clients MCP (Hermes, etc.)

Les outils de documentation sont conçus pour fonctionner avec **n'importe quel
client MCP**, Hermes agent en cible : transport **stdio** standard, schémas
d'outils classiques, résultats **texte + JSON** (pas de dépendance aux
fonctionnalités MCP optionnelles `resources`/`prompts`/`sampling` que certains
clients ne gèrent pas). L'accès au vault se fait **par fichiers**, sans exiger
qu'Obsidian soit lancé : il suffit que le serveur MCP ait accès au dossier du
vault.

## Pré-requis côté GestSup

1. **API activée** : Administration → Paramètres → Connecteurs → onglet **API**.
2. Une **clé d'API** générée.
3. Accès en **HTTPS** (l'API refuse tout port ≠ 443).
4. Si une **liste blanche d'IP** est configurée, l'IP du serveur MCP doit y figurer.
5. Pour les outils 🔌 : le **plugin `gestsup_mcp`** installé et activé
   (voir [`plugin/gestsup_mcp/README.md`](plugin/gestsup_mcp/README.md)).

## Installation (serveur MCP)

```bash
npm install
npm run build
```

## Configuration

Variables d'environnement (voir [`.env.example`](.env.example)) :

| Variable | Requis | Défaut | Description |
|---|---|---|---|
| `GESTSUP_BASE_URL` | ✅ | — | URL de l'instance, sans `/api/v1` (HTTPS). |
| `GESTSUP_API_KEY` | ✅ | — | Clé d'API GestSup (**secret**). |
| `GESTSUP_DEFAULT_USER_ID` | ✅* | — | Identité technicien : auteur des écritures et définition de « mes tickets ». *Requis pour les écritures.* |
| `GESTSUP_AUTH_MODE` | ❌ | `header` | `header` (X-API-KEY) ou `basic`. |
| `GESTSUP_TIMEOUT_MS` | ❌ | `15000` | Timeout HTTP (ms). |
| `GESTSUP_ALLOW_WRITES` | ❌ | `true` | `false` = lecture seule (kill-switch). |
| `GESTSUP_INCIDENT_TYPE_IDS` | ❌ | — | Ids des types « incident » (cause obligatoire à la clôture), séparés par des virgules. À défaut, détection par le nom du type. |
| `GESTSUP_INSECURE_TLS` | ❌ | `false` | `true` = ignore la vérification TLS (**test local uniquement**, ex. Docker auto-signé). |
| `OBSIDIAN_VAULT_PATH` | ❌ | — | Racine du vault Obsidian (dossier local **ou partage réseau monté** : SMB/NFS…). **Active** les outils de documentation si défini. |
| `OBSIDIAN_DOCS_FOLDER` | ❌ | `KB` | Sous-dossier des notes générées. |
| `OBSIDIAN_ALLOW_WRITES` | ❌ | `true` | `false` = lecture seule du vault (kill-switch). |
| `GESTSUP_DOC_QUALITY_THRESHOLD` | ❌ | `60` | Score minimal (0-100) pour juger un ticket « documentable ». |

## Brancher sur Claude Desktop

Dans `claude_desktop_config.json` :

```json
{
  "mcpServers": {
    "gestsup": {
      "command": "node",
      "args": ["/chemin/absolu/vers/Gestsup-mcp/dist/index.js"],
      "env": {
        "GESTSUP_BASE_URL": "https://support.exemple.fr",
        "GESTSUP_API_KEY": "votre-cle",
        "GESTSUP_DEFAULT_USER_ID": "1"
      }
    }
  }
}
```

> Sous Windows, utilisez des `/` dans le chemin (ou doublez les `\\`). La version
> **Microsoft Store** de Claude Desktop lit sa config dans
> `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\` (pas dans
> `%APPDATA%\Claude\`).

## Tester en local sans risque (Docker)

Le dossier [`docker/`](docker/) monte une instance **GestSup jetable** (données
d'exemple, **plugin auto-installé et activé**) :

```bash
cd docker
./fetch-source.sh
docker compose up -d --build
```

Interface web : http://localhost:8080 (`admin` / `admin`). Détails et branchement
du MCP : [README du stack](docker/README.md). Revalidation bout-en-bout :
[`test-integration/`](test-integration/).

## Développement & tests

```bash
npm run typecheck   # types
npm test            # tests unitaires (vitest, réseau simulé)
npm run dev         # compilation en watch
```

Inspecter le serveur : `npx @modelcontextprotocol/inspector node dist/index.js`.

## Notes

- **Version de référence : GestSup 3.2.55** (source = mirroir public
  `DeltaForce53/gestsup-3.2.55`). Pour suivre une montée de version, voir le
  [runbook](docs/maintenance-gestsup-updates.md).
- Le serveur **gomme les pièges de l'API** : décodage HTML, pagination par
  numéro de page, gestion des erreurs 403/404/405, kill-switch d'écriture.
- La **clé d'API n'est jamais journalisée**.

## Licence

MIT.
