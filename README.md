# GestSup MCP

Serveur **MCP (Model Context Protocol)** pour piloter les **tickets GestSup**
depuis un agent LLM (Claude Desktop, Claude Code, etc.), accompagné d'une
**documentation complète de l'API REST GestSup**.

## Sommaire

| Élément | Description |
|---|---|
| **Serveur MCP** (`src/`) | 6 outils de gestion de tickets, prêts à brancher sur un client MCP. |
| [`docs/gestsup-api.md`](docs/gestsup-api.md) | Documentation complète de l'API REST GestSup, reconstruite depuis le code source. |
| [`docs/mcp-server-plan.md`](docs/mcp-server-plan.md) | Plan d'architecture détaillé du serveur. |
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

> Périmètre = ce que l'API GestSup permet réellement (création de ticket,
> commentaires, lecture). La modification d'état, l'affectation et la gestion
> des équipements ne sont **pas** exposées par l'API GestSup (cf. la doc).

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
