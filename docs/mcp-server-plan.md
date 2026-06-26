# Plan d'implémentation — Serveur MCP pour GestSup

Ce document propose un plan complet pour exposer l'API REST de GestSup
(cf. [`gestsup-api.md`](./gestsup-api.md)) sous forme d'un **serveur MCP**
(Model Context Protocol), afin qu'un agent LLM (Claude, etc.) puisse créer et
consulter des tickets GestSup en langage naturel.

> Basé sur l'API GestSup **3.2.55**. Les 5 endpoints stub (PUT/DELETE ticket,
> gestion user) étant désactivés côté GestSup, le serveur MCP exposera d'abord
> les **7 opérations réellement fonctionnelles**, avec une architecture prête à
> accueillir les autres dès qu'elles existeront.

---

## 1. Objectif & périmètre

**But** : un serveur MCP « GestSup » que l'on branche à un client MCP (Claude
Desktop, Claude Code, un agent maison…) pour :

- créer un ticket,
- lire un ticket et son fil de résolution,
- ajouter un commentaire à un ticket,
- lister les tickets d'un demandeur,
- lire une fiche utilisateur,
- récupérer les référentiels (types / catégories / sous-catégories / lieux).

**Non-objectif (V1)** : modifier/clôturer un ticket, gérer les utilisateurs ou
les équipements (non supportés par l'API GestSup actuelle).

---

## 2. Choix techniques recommandés

| Sujet | Reco | Justification |
|---|---|---|
| Langage | **TypeScript / Node.js** | SDK MCP officiel mûr (`@modelcontextprotocol/sdk`), large adoption, packaging `npx` simple |
| SDK | `@modelcontextprotocol/sdk` | Implémentation de référence du protocole |
| Transport | **stdio** (V1) puis **HTTP/SSE** (optionnel) | stdio = intégration locale immédiate (Claude Desktop) ; HTTP pour un déploiement partagé |
| HTTP client | `undici` (natif Node) ou `axios ≥ 1.16.1` | multipart/form-data requis ; éviter les vieux axios derrière proxy |
| Validation | **Zod** | schémas d'entrée des tools + validation runtime |
| Config | variables d'environnement + `.env` | clé API = secret, ne jamais logguer |
| Tests | `vitest` + serveur GestSup mocké (`nock`/`msw`) | tester la logique sans instance réelle |

> Alternative Python (`mcp` SDK officiel + `httpx`) tout aussi valable si
> l'écosystème cible est Python. Le reste du plan s'y transpose 1:1.

---

## 3. Architecture

```
gestsup-mcp/
├── src/
│   ├── index.ts            # bootstrap serveur MCP (stdio), enregistrement tools
│   ├── config.ts           # lecture/validation env (Zod) : URL, clé, options
│   ├── gestsupClient.ts    # client HTTP bas niveau de l'API GestSup
│   ├── normalize.ts        # normalisation des réponses (code/type, html_decode, dates)
│   ├── errors.ts           # mapping erreurs HTTP/métier → erreurs MCP lisibles
│   └── tools/
│       ├── createTicket.ts
│       ├── getTicket.ts
│       ├── addTicketResolution.ts
│       ├── findTicketsByUser.ts
│       ├── getUser.ts
│       └── listReferential.ts   # type / category / subcat / place
├── test/
├── package.json
├── tsconfig.json
└── README.md
```

**Couches** :
1. **`gestsupClient`** : connaît l'API GestSup (auth header, base path, multipart,
   query string). Une méthode par endpoint. Aucune logique MCP ici.
2. **`tools/*`** : adaptateurs MCP. Chacun = schéma Zod + description orientée
   LLM + appel client + normalisation + formatage de sortie.
3. **`normalize`/`errors`** : lissent les pièges de l'API (types incohérents,
   HTML-encoding, offset=page, 404 « aucun ticket », bug `action` subcat).

---

## 4. Configuration (variables d'environnement)

| Variable | Requis | Description |
|---|---|---|
| `GESTSUP_BASE_URL` | ✅ | ex. `https://support.exemple.fr` (sans `/api/v1`) |
| `GESTSUP_API_KEY` | ✅ | clé d'API (2048 hex) — **secret** |
| `GESTSUP_AUTH_MODE` | ❌ | `header` (défaut) ou `basic` |
| `GESTSUP_TIMEOUT_MS` | ❌ | timeout requêtes (défaut 15000) |
| `GESTSUP_DEFAULT_USER_ID` | ❌ | auteur par défaut pour les commentaires |
| `GESTSUP_ALLOW_WRITES` | ❌ | `true`/`false` (défaut `true`) : kill-switch pour n'autoriser que la lecture |

Règles : la clé n'est **jamais** journalisée ; le client force HTTPS (l'API
refuse le port 80). En `header`, on envoie `X-API-KEY` ; en `basic`, on envoie
`Authorization: Basic base64(api_key)`.

---

## 5. Tools MCP exposés (V1)

Chaque tool a un **nom**, une **description pensée pour le LLM**, un **schéma
d'entrée Zod**, et renvoie un contenu structuré + texte résumé.

### 5.1 `gestsup_create_ticket`
> Crée un nouveau ticket de support dans GestSup.

| Input | Type | Notes |
|---|---|---|
| `title` | string (req) | → `ticket_title` |
| `description` | string (req) | → `ticket_description` |
| `type_id` | number (opt) | → `ticket_type` (valider via référentiel) |
| `requester_email` | string (opt) | → `ticket_user_mail` |

Sortie : `{ ticket_id, ticket_url }` + message. Soumis au kill-switch
`GESTSUP_ALLOW_WRITES`.

### 5.2 `gestsup_get_ticket`
> Récupère un ticket et l'historique de sa résolution par son numéro.

Input : `ticket_id` (number, req). Sortie : objet ticket normalisé +
`resolution[]` (avec `thread_type_name` lisible). Gère le `404`.

### 5.3 `gestsup_add_ticket_comment`
> Ajoute un commentaire (texte) au fil de résolution d'un ticket.

| Input | Type | Notes |
|---|---|---|
| `ticket_id` | number (req) | |
| `text` | string (req) | |
| `user_id` | number (opt) | défaut = `GESTSUP_DEFAULT_USER_ID` |

⚠️ L'API n'effectue **aucune** vérification d'existence : le tool **doit**
valider en amont (appeler `get_ticket`) pour éviter les commentaires orphelins.

### 5.4 `gestsup_find_tickets_by_user`
> Liste les tickets d'un demandeur, avec tri et pagination.

| Input | Type | Défaut |
|---|---|---|
| `user_id` | number (req) | |
| `order` | enum(`id`,`date_create`,`date_modif`) | `date_create` |
| `sort` | enum(`ASC`,`DESC`) | `DESC` |
| `limit` | number | 20 |
| `page` | number (≥0) | 0 |

> Le tool expose **`page`** (intuitif) et le mappe sur le paramètre `offset` de
> l'API (qui est déjà un n° de page). Masque le piège `offset = limit*offset`.
> Traduit le `404 « No tickets found »` en **liste vide** (succès), plus naturel
> pour un agent.

### 5.5 `gestsup_get_user`
> Récupère la fiche d'un utilisateur par son ID.

Input : `user_id` (number, req). Sortie : champs `firstname…profile`. Gère `404`.

### 5.6 `gestsup_list_referential`
> Liste un référentiel : types, catégories, sous-catégories ou lieux de ticket.

Input : `kind` enum(`type`,`category`,`subcat`,`place`). Un seul tool
paramétré plutôt que 4 (moins de surface pour le LLM). Normalise le bug
`action=TicketCategoryList` des sous-catégories.

> **Option « Resources »** : exposer en plus ces référentiels comme
> *MCP resources* (`gestsup://referential/types`, …) en lecture seule, pour que
> le client puisse les mettre en cache / les fournir en contexte sans appel de
> tool.

---

## 6. Normalisation & robustesse (cœur de la valeur ajoutée)

Le serveur MCP doit **gommer les aspérités** documentées dans `gestsup-api.md` :

1. **Succès/échec** : interpréter `code == 0 || type == 'success'` de façon
   tolérante (string **ou** int) et exposer un booléen propre.
2. **HTML-decoding** : les textes renvoyés sont `htmlspecialchars`-encodés →
   décoder (`&quot;`, `&#039;`, …) avant de les donner au LLM.
3. **Dates** : conserver l'ISO (`*_date_create`) et ignorer/normaliser le format
   FR redondant.
4. **`thread_type`** : fournir le libellé clair (text/attribution/transfert/
   mail/close/switch state).
5. **Pagination** : exposer `page`, masquer `offset`.
6. **404 « aucun résultat »** (findByUser) → liste vide, pas une erreur.
7. **Erreurs auth** (`403`) → message d'aide explicite : « API désactivée /
   clé invalide / IP non autorisée / HTTPS requis » selon le `message` GestSup.
8. **Kill-switch écriture** : si `GESTSUP_ALLOW_WRITES=false`, les tools de
   création renvoient une erreur claire sans appeler GestSup.

---

## 7. Sécurité

- **Secret** : `GESTSUP_API_KEY` via env/secret manager, jamais en clair dans
  les logs ni les messages d'erreur renvoyés au LLM.
- **HTTPS only** : refuser toute `GESTSUP_BASE_URL` en `http://`.
- **Périmètre minimal** : V1 surtout en lecture ; l'écriture (create/comment)
  est explicite et gouvernée par le kill-switch.
- **Validation stricte des entrées** (Zod) avant tout appel réseau (types
  numériques, longueur du titre ≤ 100, enums).
- **Rate limiting / retry** doux côté client (backoff sur erreurs réseau) sans
  marteler GestSup.
- **Confirmation des actions sensibles** : marquer `create_ticket` /
  `add_comment` comme opérations à effet de bord (le client MCP peut alors
  demander confirmation à l'utilisateur).

---

## 8. Tests & validation

1. **Unitaires** : `normalize`/`errors` (cas string vs int, HTML-decode,
   mapping 403/404).
2. **Client** : mock HTTP (`nock`/`msw`) reproduisant les réponses réelles
   (succès + chaque code d'erreur documenté).
3. **Tools** : valider schémas Zod (rejet d'entrées invalides) + format de
   sortie.
4. **Intégration (optionnel)** : contre une instance GestSup de test
   (docker, cf. `SpiizN/gestsup-docker`) avec une vraie clé.
5. **Conformité MCP** : tester via l'**MCP Inspector** (`npx @modelcontextprotocol/inspector`).

---

## 9. Packaging & distribution

- Publier en binaire `npx`-able : `npx gestsup-mcp` (champ `bin` dans
  `package.json`).
- Fournir un exemple de config client :
  ```json
  {
    "mcpServers": {
      "gestsup": {
        "command": "npx",
        "args": ["-y", "gestsup-mcp"],
        "env": {
          "GESTSUP_BASE_URL": "https://support.exemple.fr",
          "GESTSUP_API_KEY": "<clé>"
        }
      }
    }
  }
  ```
- README : pré-requis GestSup (API activée, clé, HTTPS, IP autorisée), table
  des tools, limites connues (renvoi vers `gestsup-api.md`).
- Image **Docker** optionnelle pour le transport HTTP/SSE (déploiement partagé).

---

## 10. Feuille de route

**Phase 0 — Préparation**
- [ ] Valider l'API sur l'instance cible (3.2.60) : `ls api/v1/`, `swagger.json`,
      tester `ticket/type/` avec la vraie clé.
- [ ] Confirmer la sémantique `offset` et les libellés de réponse.

**Phase 1 — MVP (lecture)**
- [ ] `config` + `gestsupClient` (auth header, HTTPS, timeout).
- [ ] `normalize`/`errors`.
- [ ] Tools : `get_ticket`, `find_tickets_by_user`, `get_user`,
      `list_referential`.
- [ ] Tests unitaires + MCP Inspector.

**Phase 2 — Écriture**
- [ ] Tools : `create_ticket`, `add_ticket_comment` (+ kill-switch + validation
      d'existence).
- [ ] Tests d'intégration sur GestSup docker.

**Phase 3 — Confort & déploiement**
- [ ] Référentiels en *resources* MCP + cache.
- [ ] Transport HTTP/SSE + image Docker.
- [ ] Packaging `npx`, README, CI (lint/test/build).

**Phase 4 — Extensions (dès que l'API GestSup le permet)**
- [ ] Activer `update_ticket` / changement d'état / clôture si les endpoints
      stub deviennent fonctionnels en 3.2.6x+.
- [ ] Gestion utilisateurs / équipements (assets) si exposés un jour.

---

## 11. Risques & points d'attention

| Risque | Mitigation |
|---|---|
| **Écart 3.2.55 → 3.2.60** sur l'API | Phase 0 de validation sur l'instance réelle avant codage |
| API en **lecture quasi seule** | Cadrer les attentes : pas de workflow complet (état/affectation) en V1 |
| **Clé unique partagée** (pas d'identité par utilisateur) | Tracer `user_id` dans les commentaires ; documenter que toutes les actions passent par un même compte technique |
| **Pièces jointes non supportées** (`file1` inerte) | Ne pas exposer d'upload tant que GestSup ne le gère pas |
| **HTML-encoding** des contenus | Décodage systématique dans `normalize` |
| **Liste blanche IP** côté GestSup | Documenter que l'IP du serveur MCP doit être autorisée |
| **LLM crée des tickets en boucle** | Kill-switch écriture + opérations marquées « effet de bord » + confirmation côté client |
