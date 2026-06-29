# GestSup MCP

Serveur **MCP (Model Context Protocol)** pour piloter les **tickets GestSup**
depuis un agent LLM (Claude Desktop, Claude Code, etc.), accompagné d'une
**documentation complète de l'API REST GestSup**.

## Sommaire

| Élément | Description |
|---|---|
| **Serveur MCP** (`src/`) | Outils de gestion de tickets (lecture + écriture), prêts à brancher sur un client MCP. |
| **Plugin** ([`plugin/gestsup_mcp/`](plugin/gestsup_mcp/)) | Addon serveur GestSup ajoutant les endpoints d'écriture/recherche (réplique la logique native + réutilise le mailer). |
| [`docs/gestsup-api.md`](docs/gestsup-api.md) | Documentation complète de l'API REST GestSup, reconstruite depuis le code source. |
| [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md) | Plan d'architecture détaillé du serveur. |
| [`docs/maintenance-gestsup-updates.md`](docs/maintenance-gestsup-updates.md) | **Runbook** : mettre à jour le plugin/MCP quand GestSup évolue. |
| [`test-integration/`](test-integration/) | Harnais de revalidation bout-en-bout (endpoints + mails) contre une instance réelle. |
| [`docs/reference/swagger-v1-3.2.55.json`](docs/reference/swagger-v1-3.2.55.json) | Swagger d'origine (incomplet, fourni pour référence). |

## Outils MCP exposés

| Outil | Rôle |
|---|---|
| `gestsup_create_ticket` | Créer un ticket (titre, description, type, email demandeur). |
| `gestsup_get_ticket` | Lire un ticket + son fil de résolution. |
| `gestsup_add_ticket_comment` | Ajouter un commentaire à un ticket (avec vérification d'existence). |
| `gestsup_find_tickets_by_user` | Lister les tickets d'un demandeur (tri + pagination). |
| `gestsup_get_user` | Lire la fiche d'un utilisateur. |
| `gestsup_list_referential` | Lister types / catégories / sous-catégories / lieux. |
| `gestsup_search_tickets` ⭐ | Rechercher des tickets par **technicien**, état, catégorie, mots-clés, dates. **Nécessite le plugin `gestsup_mcp`** (voir ci-dessous). |

> Les 6 premiers outils n'utilisent que l'API GestSup native. Le 7e
> (`gestsup_search_tickets`) s'appuie sur un **plugin serveur optionnel** qui
> ajoute ce que l'API native ne sait pas faire (lister par technicien, recherche
> globale). La modification d'état, l'affectation et la gestion des équipements
> ne sont pas encore exposées (prochaines étapes du plugin).

## Scénarios d'assistant (exemples)

Une fois branché, tu pilotes GestSup en langage naturel ; l'assistant combine les
outils :

- **Point quotidien sur mes tickets** : *« Fais le point sur mes tickets ouverts »*
  → `gestsup_search_tickets(technician_id=<moi>, exclude_state_ids=[<résolu/rejeté>])`
  puis synthèse par état/priorité. (Les ids d'états « terminaux » viennent de
  `gestsup_list_referential kind=state`.)
- **Résumé d'un ticket** : *« Résume le ticket 1234 »* → `gestsup_get_ticket` + synthèse.
- **Résumer les tickets d'un demandeur** : *« Où en sont les tickets de Marie ? »*
  → `gestsup_find_tickets_by_user` / `gestsup_search_tickets(requester_id=…)`.
- **« Point infra » du chef** : *« Synthèse des tickets de l'équipe Réseau »*
  → `gestsup_search_tickets(... )` filtré par technicien(s)/groupe, puis synthèse.
- **Agir** : commenter, noter en interne, changer l'état/résoudre, affecter,
  mettre à jour (catégorie/priorité/temps), clôturer (conforme), créer un ticket
  complet — chaque action notifie selon **tes paramètres GestSup**.

> L'identité « moi » = `GESTSUP_DEFAULT_USER_ID` (ton id technicien). Toutes les
> valeurs (états, priorités, catégories, techniciens, procédures…) sont **lues de
> ton instance**, jamais codées en dur.

## Plugin serveur GestSup `gestsup_mcp` (optionnel)

L'API native ne sait **pas** lister les tickets par technicien ni faire de
recherche globale. Le dossier [`plugin/gestsup_mcp/`](plugin/gestsup_mcp/) est un
**addon GestSup** (PHP) qui ajoute un endpoint **lecture seule** pour ça, en
réutilisant la clé API existante. Sans lui, les 6 autres outils fonctionnent ;
seul `gestsup_search_tickets` requiert son installation.

Installation résumée (détails dans le [README du plugin](plugin/gestsup_mcp/README.md)) :
copier `plugin/gestsup_mcp/` dans le dossier `plugins/` de GestSup, exécuter
`_SQL/install.sql`, puis activer le plugin dans Administration → Paramètres →
Plugins. **Le cœur de GestSup n'est pas modifié.**

## Pré-requis côté GestSup

1. **API activée** : Administration → Paramètres → Connecteurs → onglet **API**.
2. Une **clé d'API** générée (longue chaîne hexadécimale).
3. Accès en **HTTPS** (l'API refuse tout port ≠ 443).
4. Si une **liste blanche d'IP** est configurée, l'IP du serveur MCP doit y figurer.

## Installation

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
| `GESTSUP_AUTH_MODE` | ❌ | `header` | `header` (X-API-KEY) ou `basic`. |
| `GESTSUP_TIMEOUT_MS` | ❌ | `15000` | Timeout HTTP (ms). |
| `GESTSUP_DEFAULT_USER_ID` | ❌ | — | Auteur par défaut des commentaires. |
| `GESTSUP_ALLOW_WRITES` | ❌ | `true` | `false` = lecture seule (kill-switch). |
| `GESTSUP_INSECURE_TLS` | ❌ | `false` | `true` = ignore la vérification du certificat TLS (**test local uniquement**, ex. stack Docker auto-signé). |

## Tester en local sans risque (Docker)

Le dossier [`docker/`](docker/) monte une instance **GestSup jetable** avec des
**données d'exemple** et l'API activée, pour essayer le serveur MCP sans toucher
à ta production :

```bash
cd docker
./fetch-source.sh
docker compose up -d --build
```

Interface web : http://localhost:8080 (`admin` / `admin`). Voir le
[README du stack](docker/README.md) pour brancher le MCP dessus.

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

## Développement & tests

```bash
npm run typecheck   # vérification des types
npm test            # tests unitaires (vitest, sans instance GestSup)
npm run dev         # compilation en watch
```

Inspecter le serveur avec l'outil officiel :

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Notes importantes

- **Version de l'API** : la doc et le client sont basés sur **GestSup 3.2.55**
  (la 3.2.60 visée n'a pas pu être téléchargée — `gestsup.fr` bloqué par la
  politique réseau ; source = mirroir public `DeltaForce53/gestsup-3.2.55`).
  L'API évolue très peu entre versions mineures ; voir la section *« Écarts
  possibles 3.2.55 → 3.2.60 »* de la doc pour les points à revalider.
- Le serveur **gomme les pièges de l'API** : décodage HTML des textes,
  pagination par numéro de page (masque le `offset` non trivial), gestion fine
  des erreurs 403/404/405, kill-switch d'écriture.
- La **clé d'API n'est jamais journalisée**.

## Licence

MIT.
