# GestSup MCP

Serveur **MCP (Model Context Protocol)** pour piloter les **tickets GestSup**
depuis un agent LLM (Claude Desktop, etc.), accompagné d'un **plugin serveur
GestSup** qui ajoute les endpoints manquants (recherche + écritures) et d'une
**documentation de l'API REST GestSup**.

## Sommaire

| Élément | Description |
|---|---|
| **Serveur MCP** (`src/`) | Outils de gestion de tickets (lecture + écriture) à brancher sur un client MCP. |
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
