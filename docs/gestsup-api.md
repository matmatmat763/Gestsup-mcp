# Documentation de l'API REST GestSup

> **Version analysée : GestSup 3.2.55** (dossier `api/v1/`).
> La cible demandée était la **3.2.60**, mais son code source n'a pas pu être
> récupéré (le domaine `gestsup.fr` est bloqué par la politique réseau de
> l'environnement, et aucun mirroir public 3.2.56→3.2.60 n'existe sur GitHub).
> Le mirroir le plus récent disponible est
> [`DeltaForce53/gestsup-3.2.55`](https://github.com/DeltaForce53/gestsup-3.2.55).
> L'API GestSup évolue très peu d'une version mineure à l'autre : cette doc est
> donc valable à ~99 % pour la 3.2.60, mais **considérez la section
> « Écarts possibles 3.2.55 → 3.2.60 » comme une zone à revalider**.

Cette documentation est reconstruite **à partir du code source** (et non du
seul `swagger.json`, qui s'avère très incomplet — voir la section dédiée).
Elle reflète le comportement réel des scripts PHP de `api/v1/`.

---

## 1. Vue d'ensemble

| Élément | Valeur |
|---|---|
| Style | REST, réponses JSON |
| Base path | `https://<votre-serveur>/api/v1` |
| Versionnement | un seul namespace : `v1` |
| Format d'entrée | `multipart/form-data` (POST) ou query string (GET) |
| Format de sortie | `application/json` (toujours, `JSON_PRETTY_PRINT`) |
| Authentification | clé d'API statique (header `X-API-KEY` **ou** Basic Auth) |
| Transport | **HTTPS obligatoire** (port 443 vérifié côté serveur) |
| Doc embarquée | `…/api/v1/swagger.json` + Swagger UI dans `vendor/components/swagger-ui/` |

L'API est implémentée par des scripts PHP « plats » (un fichier = un groupe de
routes), routés par un `.htaccess` Apache (mod_rewrite requis). Il n'y a pas de
framework : chaque endpoint inclut `init.php` (auth + connexion DB) puis exécute
des requêtes SQL directes via PDO.

---

## 2. Pré-requis serveur

L'API n'est utilisable que si **toutes** ces conditions sont réunies (vérifiées
dans `api/v1/init.php`) :

1. **mod_rewrite** activé et `AllowOverride All` dans la conf Apache
   (le `.htaccess` de `api/v1/` fait tout le routage).
2. **API activée** dans l'application : `tparameters.api = 1`.
3. **Clé d'API définie** : `tparameters.api_key` non vide.
4. **HTTPS** : `$_SERVER["SERVER_PORT"]` doit valoir `443`, sinon `403`.
5. (Optionnel) **IP cliente autorisée** si `tparameters.api_client_ip` est
   renseigné (liste blanche).

Page de diagnostic : `GET …/api/v1/` (= `index.php`) affiche l'état de
mod_rewrite et de HTTPS, et un lien vers la doc Swagger.

---

## 3. Activation & configuration (côté admin)

Interface : **Administration → Paramètres → Connecteurs → onglet « API »**
(`admin/parameters/connector.php`).

- Case à cocher **API** → écrit `tparameters.api`.
- À la **première activation**, la clé est générée automatiquement :
  ```php
  $_POST['api_key'] = bin2hex(random_bytes(1024)); // => 2048 caractères hexadécimaux
  ```
  ⚠️ La clé GestSup est donc **très longue (2048 hex)**. L'UI n'en affiche que
  les 24 premiers caractères (`substr(api_key,0,24).'*****'`) + bouton « copier ».
- Champ **IP Client** (`api_client_ip`) : liste d'IP autorisées, séparées par
  des virgules (voir §4.3 pour le mécanisme exact).
- Lien **Documentation** : `…/api/v1/swagger.json`.

Table de stockage : `tparameters` (ligne unique), colonnes
`api`, `api_key`, `api_client_ip`, `server_url`.

---

## 4. Authentification & sécurité

### 4.1 Deux méthodes d'authentification acceptées

Le `swagger.json` ne documente **que** `X-API-KEY`. Le code accepte en réalité
**aussi** le Basic Auth :

**Méthode A — header `X-API-KEY` (recommandée)**
```http
X-API-KEY: <api_key>
```

**Méthode B — HTTP Basic Auth** (non documentée dans le swagger)
```http
Authorization: Basic base64(<api_key>)
```
Le code récupère l'en-tête `Authorization`, retire le préfixe `Basic `, puis
`base64_decode()` la valeur restante et la compare à la clé. (Seul le
« mot de passe » base64 est utilisé ; il s'agit en pratique de
`base64(api_key)`, ou `base64(":api_key")` selon le client.)

### 4.2 Tolérance sur un préfixe de clé (comportement non évident)

Si la clé fournie ne correspond pas exactement, le code **réessaie en retirant
le premier caractère** :
```php
if($parameters['api_key'] != $api_key) {
    $api_key_sub = substr($api_key, 1);          // retire le 1er caractère
    if($parameters['api_key'] != $api_key_sub) { /* 403 Wrong API Key */ }
}
```
C'est un contournement historique (préfixe parasite ajouté par certains
clients). À connaître pour le débogage.

### 4.3 Liste blanche d'IP (`api_client_ip`)

Si renseigné, chaque IP de la liste est utilisée comme **motif d'expression
régulière** (`preg_match`) contre `$_SERVER['REMOTE_ADDR']` :
```php
foreach(explode(',', $parameters['api_client_ip']) as $ip) {
    if(preg_match('/'.$ip.'/', $_SERVER['REMOTE_ADDR'])) { $valid_ip = 1; }
}
```
⚠️ Conséquence : une entrée comme `192.168.1.10` matche aussi `192.168.1.100`
(c'est une regex non ancrée, le `.` est un joker). Échec → `403`.

### 4.4 Récapitulatif des refus (tous renvoient HTTP 403)

| Condition | `message` JSON |
|---|---|
| API désactivée | `API disabled in application` |
| Pas d'en-tête clé | `Unable to get API Key, add X-API-KEY header` |
| Clé non configurée côté serveur | `API key not defined in application` |
| IP non autorisée | `Unauthorized IP (<ip>) in application` |
| Clé absente | `Missing API key parameter` |
| Mauvaise clé | `Wrong API Key` |
| Port ≠ 443 | `Unauthorized access port, use 443. (<port>)` |

Tous les refus sont journalisés via `LogIt('API_error', …)` (visibles dans les
logs applicatifs GestSup).

---

## 5. Format de réponse commun

Toutes les réponses sont du JSON. Champs récurrents :

| Champ | Type | Signification |
|---|---|---|
| `code` | `"0"` / `"1"` | `0` = succès, `1` = erreur |
| `type` | `"success"` / `"error"` | idem, en texte |
| `action` | string | nom logique de l'opération (ex. `TicketAdd`) |
| `message` | string | message lisible (présent surtout en erreur / création) |
| `info` | string | message de traitement optionnel |

> ⚠️ **Incohérence de typage** : `code`/`type` sont des **chaînes** dans les
> réponses construites « à la main » (`'0'`/`'1'`), mais des **entiers** dans
> certaines branches d'erreur (`'code' => 1`). Côté client, comparez de façon
> tolérante (`== 0` plutôt que `=== "0"`).

Les listes (`/ticket/type/`, `/ticket/findByUser`, …) renvoient un **tableau
JSON d'objets**, chaque objet portant ses propres `code`/`type`/`action`
(il n'y a pas d'enveloppe globale).

### Codes HTTP utilisés

| Code | Sens dans GestSup |
|---|---|
| `200` | OK |
| `400` | Champ requis manquant / valeur invalide |
| `403` | Auth / sécurité (voir §4.4) |
| `404` | Ressource introuvable (ticket / user inexistant ou aucun résultat) |
| `405` | Méthode HTTP non autorisée **ou endpoint stub désactivé** (§7) |
| `500` | Erreur API (déclarée dans le swagger ; rarement émise telle quelle) |

---

## 6. Endpoints disponibles (fonctionnels)

Routage réel (`api/v1/.htaccess`) :

```apache
RewriteRule ^ticket/findByUser   ticket.php        [NC,L]
RewriteRule ^ticket/type/        ticket_type.php
RewriteRule ^ticket/category/    ticket_category.php
RewriteRule ^ticket/subcat/      ticket_subcat.php
RewriteRule ^ticket/place/       ticket_place.php
RewriteRule ^ticket/(.*)$        ticket.php?id=$1
RewriteRule ^ticket/             ticket.php
RewriteRule ^user/(.*)$          user.php?user_id=$1
```

### 6.1 `POST /ticket/` — Créer un ticket

- **Handler** : `func/TicketAdd.php`
- **Auth** : oui · **Content-Type** : `multipart/form-data`

| Champ (form-data) | Requis | Description |
|---|---|---|
| `ticket_title` | ✅ | Titre du ticket (max 100 car. en base) |
| `ticket_description` | ✅ | Description (longtext) |
| `ticket_type` | ❌ | ID du type (`ttypes.id`), doit être numérique |
| `ticket_user_mail` | ❌ | Email du demandeur ; résolu en `user` via `tusers.mail`. Si inconnu → `user = 0` |
| `file1` | ❌ | Référencé dans le code mais **non traité** en 3.2.55 (pièce jointe non implémentée). Ne pas utiliser. |

Comportement : insère dans `tincidents` avec `state = 5` (état par défaut
« nouveau »), `date_create`/`date_modif` = maintenant.

**Réponse 200**
```json
{
  "code": 0, "type": "success", "action": "TicketAdd",
  "message": "Ticket 1234 created",
  "ticket_id": "1234",
  "ticket_url": "https://serveur/index.php?page=ticket&id=1234"
}
```
**Erreurs** : `400` si `ticket_title`/`ticket_description` manquant, ou
`ticket_type` non numérique.

> Note : les champs `ticket_type`, `ticket_title`, `ticket_description`,
> `ticket_user_mail` sont passés à `htmlspecialchars(..., ENT_QUOTES)` côté
> serveur — le contenu stocké est donc HTML-encodé.

---

### 6.2 `GET /ticket/{ticket_id}` — Détail d'un ticket

- **Handler** : `func/TicketGet.php`
- **Auth** : oui · route : `ticket/<id>` → `ticket.php?id=<id>`

Renvoie le ticket **et son fil de résolution** (threads). Ignoré si `disable=1`.

**Réponse 200 (extrait)**
```json
{
  "code": "0", "type": "success", "action": "TicketGet",
  "ticket_id": "1234",
  "ticket_technician": "Jean Dupont",
  "ticket_type_id": "2",
  "ticket_type_name": "Incident",
  "ticket_title": "...",
  "ticket_description": "...",
  "ticket_date_create": "2025-02-01 10:00:00",
  "ticket_date_create_fr": "01/02/2025 10:00:00",
  "ticket_state_id": "5",
  "ticket_state_name": "Nouveau",
  "ticket_resolution": [
    {
      "thread_id": "1",
      "thread_type_id": "0",
      "thread_type_name": "text",
      "thread_date": "2025-02-01 10:05:00",
      "thread_author": "Jean Dupont",
      "thread_text": "..."
    }
  ]
}
```

**Types de thread** (`thread_type_id`) :

| id | `thread_type_name` | Sens |
|----|------|------|
| 0 | `text` | Commentaire / texte |
| 1 | `attribution` | Attribution à un technicien |
| 2 | `transfert` | Transfert d'un technicien à un autre |
| 3 | `mail` | Envoi de mail |
| 4 | `close` | Clôture du ticket |
| 5 | `switch state` | Changement d'état (ajoute `thread_state_name`) |

**Erreur** : `404` si ticket introuvable / désactivé.

---

### 6.3 `POST /ticket/{ticket_id}/resolution` — Ajouter un commentaire

- **Handler** : `func/TicketAddResolution.php`
- **Auth** : oui · **Content-Type** : `multipart/form-data`
- Route : un `POST` sur `ticket/<id>` (avec `id` non vide) déclenche l'ajout de
  résolution (et non la création).

| Champ | Requis | Description |
|---|---|---|
| `ticket_id` (path) | ✅ | Numéro du ticket (numérique) |
| `user_id` | ✅ | ID de l'auteur (`tusers.id`, numérique) |
| `text` | ✅ | Texte du commentaire |

Insère un `tthreads` de `type = 0` (texte). **Aucune vérification d'existence**
du ticket ou de l'utilisateur n'est faite ici (insertion directe).

**Réponse 200**
```json
{
  "code": 0, "type": "success", "action": "TicketAddResolution",
  "message": "Add resolution on ticket 1234",
  "ticket_id": "1234",
  "ticket_url": "https://serveur/index.php?page=ticket&id=1234"
}
```
**Erreurs** : `400` si `ticket_id`/`text`/`user_id` manquant ou non numérique.

---

### 6.4 `GET /ticket/findByUser` — Tickets d'un demandeur

- **Handler** : `func/TicketFindByUser.php`
- **Auth** : oui · paramètres en **query string**

| Param | Requis | Valeurs | Description |
|---|---|---|---|
| `user_id` | ✅ | entier | ID du demandeur (`tusers.id`) |
| `order` | ✅ | `id` \| `date_create` \| `date_modif` | colonne de tri |
| `sort` | ✅ | `ASC` \| `DESC` | sens du tri |
| `limit` | ✅ | entier | nombre de lignes |
| `offset` | ✅ | entier | **n° de page** (voir piège ci-dessous) |

> ⚠️ **Piège `offset`** : le code calcule `offset = limit * offset`. Donc
> `offset` est un **numéro de page** (0 = page 1, 1 = page 2…), pas un décalage
> de lignes. Exemple : `limit=2&offset=0` → lignes 1-2 ; `limit=2&offset=1` →
> lignes 3-4.

**Réponse 200** : tableau d'objets
```json
[
  {
    "code": "0", "type": "success", "action": "TicketsFindByUser",
    "ticket_id": "1234",
    "ticket_date_create": "2025-02-01 10:00:00",
    "ticket_date_create_fr": "01/02/2025 10:00:00",
    "ticket_subject": "...",
    "ticket_state_id": "5",
    "ticket_state_name": "Nouveau",
    "ticket_date_modif": "2025-02-02 09:00:00",
    "ticket_date_modif_fr": "02/02/2025 09:00:00"
  }
]
```
**Erreurs** :
- `400` : paramètre manquant ou `order`/`sort` hors liste, `limit`/`offset` non numériques.
- `404` : utilisateur inexistant **ou** aucun ticket trouvé.

---

### 6.5 `GET /ticket/type/` — Liste des types de ticket

- **Handler** : `ticket_type.php` · source : `ttypes` (sauf `id=0`)

```json
[
  { "code": "0", "type": "success", "action": "TicketTypeList",
    "type_id": "1", "type_name": "Incident" }
]
```

### 6.6 `GET /ticket/category/` — Liste des catégories

- **Handler** : `ticket_category.php` · source : `tcategory` (sauf `id=0`)

```json
[
  { "code": "0", "type": "success", "action": "TicketCategoryList",
    "category_id": "1", "category_name": "Réseau" }
]
```

### 6.7 `GET /ticket/subcat/` — Liste des sous-catégories

- **Handler** : `ticket_subcat.php` · source : `tsubcat` (sauf `id=0`)

```json
[
  { "code": "0", "type": "success", "action": "TicketCategoryList",
    "category_id": "1", "subcat_id": "3", "subcat_name": "Wi-Fi" }
]
```
> ⚠️ **Bug de copier-coller** : `action` vaut `TicketCategoryList` (et non
> `TicketSubcatList`) dans cette réponse. `category_id` est ici l'ID de la
> catégorie parente (`tsubcat.cat`).

### 6.8 `GET /ticket/place/` — Liste des lieux

- **Handler** : `ticket_place.php` · source : `tplaces` (sauf `id=0`)

```json
[
  { "code": "0", "type": "success", "action": "TicketPlaceList",
    "place_id": "1", "place_name": "Siège" }
]
```

> Les 4 endpoints de liste ci-dessus n'acceptent que `GET` (sinon `405`) et
> n'attendent **aucun paramètre**.

---

### 6.9 `GET /user/{user_id}` — Détail d'un utilisateur

- **Handler** : `user.php` → `func/UserGet.php` · source : `tusers` (si `disable=0`)

```json
{
  "code": "0", "type": "success", "action": "UserGet",
  "user_id": "42",
  "firstname": "Jean", "lastname": "Dupont",
  "mail": "jean.dupont@exemple.fr",
  "phone": "...", "mobile": "...", "fax": "...",
  "function": "...", "profile": "3"
}
```
**Erreur** : `404` si utilisateur introuvable / désactivé.

> Bien que `UserGet.php` fasse `SELECT *`, **seuls** les champs ci-dessus sont
> renvoyés (pas de `password`/`salt` exposés — ils existent en base mais ne
> sont pas sérialisés).

---

## 7. Endpoints « stub » (présents mais désactivés → 405)

Ces routes existent dans le code mais renvoient systématiquement
`405 Method Not Allowed` avec `message = "Method not available for …"`.
À considérer comme **non disponibles en 3.2.55** (probablement réservés pour le
futur) :

| Méthode + route | Fonction | Statut |
|---|---|---|
| `PUT /ticket/{id}` | `UpdateTicket` | 405 — non implémenté |
| `DELETE /ticket/{id}` | `DeleteTicket` | 405 — non implémenté |
| `POST /user/` | `AddUser` | 405 — non implémenté |
| `PUT /user/{id}` | `UpdateUser` | 405 — non implémenté |
| `DELETE /user/{id}` | `DeleteUser` | 405 — non implémenté |

> Il n'existe donc **aucun** moyen, via l'API 3.2.55, de : modifier/supprimer
> un ticket, changer son état/technicien, créer/modifier/supprimer un
> utilisateur, ou gérer les équipements (assets). Voir §10.

---

## 8. Pourquoi le `swagger.json` est trompeur / incomplet

Le fichier `api/v1/swagger.json` (Swagger 2.0, « version 1.0.2 bêta ») **sous-
documente** l'API. Écarts constatés vs code réel :

1. **Auth** : ne mentionne que `X-API-KEY`. Omet le **Basic Auth**, la
   **liste blanche d'IP**, l'**obligation HTTPS/443** et la tolérance de préfixe.
2. **Modèles de réponse vides** : chaque réponse n'est décrite que par
   `"200": {"description": "OK"}`. Les vrais schémas (champs `ticket_*`,
   `thread_*`, etc.) ne sont **que** dans les descriptions HTML, pas en
   `definitions`/`schema`.
3. **`basePath` erroné** : `"/master/api/v1"` (artefact de dev). Le vrai base
   path est `/api/v1`. `host` = `localhost` (placeholder).
4. **Endpoints stub non signalés** : les routes `PUT`/`DELETE` ticket et
   `POST`/`PUT`/`DELETE` user n'apparaissent pas, alors qu'elles « existent »
   (en 405).
5. **Sémantique réelle masquée** : ex. `offset` est un n° de page (×limit),
   `findByUser` exige *tous* ses paramètres, `place/type/category/subcat`
   n'acceptent que GET.
6. **Champs non documentés** : `file1` (TicketAdd), `ticket_resolution[]`
   détaillé, le bug `action=TicketCategoryList` sur subcat.
7. **Pas de codes d'erreur métier** : les `code`/`type`/`message` ne sont pas
   formalisés.

➡️ **Pour intégrer l'API, fiez-vous à cette documentation (issue du code), pas
au swagger.** Le swagger reste utile uniquement pour générer un squelette de
client, à corriger ensuite.

---

## 9. Modèle de données (tables touchées par l'API)

Référence rapide des colonnes utiles (schéma `_SQL/skeleton.sql`) :

- **`tincidents`** (tickets) : `id`, `type`, `technician`, `title`,
  `description`, `user`, `date_create`, `date_hope`, `date_res`, `date_modif`,
  `state`, `priority`, `criticality`, `category`, `subcat`, `disable`, …
- **`tthreads`** (résolution) : `id`, `ticket`, `date`, `author`, `text`,
  `type` (0–5, cf. §6.2), `state`, `private`, …
- **`tusers`** : `id`, `login`, `firstname`, `lastname`, `profile`, `mail`,
  `phone`, `mobile`, `fax`, `function`, `company`, `disable`, … (l'API n'expose
  qu'un sous-ensemble).
- **`tstates`** : `id`, `number`, `name`, `meta`, `hide` — états de ticket.
- **`ttypes`** : `id`, `name`, `service`, … — types.
- **`tcategory`** : `id`, `number`, `name`, `service`, `technician`, `type`.
- **`tsubcat`** : `id`, `cat` (catégorie parente), `name`, `technician`.
- **`tplaces`** : `id`, `name`.
- **`tparameters`** (ligne unique) : `api`, `api_key`, `api_client_ip`,
  `server_url`, `version`, … — configuration globale.

---

## 10. Limites connues de l'API 3.2.55

- **Lecture surtout** : création de ticket + ajout de commentaire ; pas de
  mise à jour d'état, d'affectation technicien, de clôture, ni de gestion des
  équipements (assets), des projets, du calendrier, etc.
- **Pas de pagination standard** (offset = n° de page, sémantique non triviale).
- **Pas de webhooks** ni de notifications sortantes côté API publique.
- **Pas de OAuth/JWT** : une seule clé statique partagée (rotation manuelle).
- **HTML-encoding** systématique des entrées texte (à décoder à l'affichage).
- **Liste blanche IP en regex** (source d'erreurs de configuration).
- **Incohérences de types** (`code`/`type` string vs int).

Au-delà de l'API publique, GestSup expose d'autres canaux d'intégration **hors
périmètre de cette doc** : `mail2ticket.php` (création de ticket par email /
IMAP, via cron ou CLI), les endpoints `ajax/*` (internes, basés session, non
authentifiés par clé), et le connecteur OCS Inventory.

---

## 11. Exemples (cURL)

> Remplacez `APIKEY` par votre clé (2048 hex) et `serveur` par votre domaine HTTPS.

**Créer un ticket**
```bash
curl -X POST "https://serveur/api/v1/ticket/" \
  -H "X-API-KEY: APIKEY" \
  -F "ticket_title=Imprimante HS" \
  -F "ticket_description=Plus de toner étage 2" \
  -F "ticket_type=1" \
  -F "ticket_user_mail=jean.dupont@exemple.fr"
```

**Lire un ticket**
```bash
curl "https://serveur/api/v1/ticket/1234" -H "X-API-KEY: APIKEY"
```

**Ajouter un commentaire**
```bash
curl -X POST "https://serveur/api/v1/ticket/1234/resolution" \
  -H "X-API-KEY: APIKEY" \
  -F "user_id=42" \
  -F "text=Intervention planifiée demain 9h"
```

**Tickets d'un demandeur (page 1, 10 par page, plus récents d'abord)**
```bash
curl "https://serveur/api/v1/ticket/findByUser?user_id=42&order=date_create&sort=DESC&limit=10&offset=0" \
  -H "X-API-KEY: APIKEY"
```

**Listes de référence**
```bash
curl "https://serveur/api/v1/ticket/type/"     -H "X-API-KEY: APIKEY"
curl "https://serveur/api/v1/ticket/category/" -H "X-API-KEY: APIKEY"
curl "https://serveur/api/v1/ticket/subcat/"   -H "X-API-KEY: APIKEY"
curl "https://serveur/api/v1/ticket/place/"    -H "X-API-KEY: APIKEY"
```

**Lire un utilisateur**
```bash
curl "https://serveur/api/v1/user/42" -H "X-API-KEY: APIKEY"
```

---

## 12. Écarts possibles 3.2.55 → 3.2.60 (à revalider)

Cette doc est basée sur la 3.2.55. Pour la 3.2.60, **vérifiez sur votre
instance** :

1. Le contenu de `…/api/v1/swagger.json` (compare-le aux endpoints ci-dessus).
2. La présence de nouveaux fichiers dans `api/v1/` (et d'éventuels `func/`
   supplémentaires) — un `ls api/v1/` sur le serveur suffit.
3. Si les endpoints **stub** (PUT/DELETE ticket, gestion user) ont été activés.
4. Le `changelog.php` filtré sur « API » entre 3.2.56 et 3.2.60.

> Le plus simple pour clore l'écart : me fournir le dossier `api/` de votre
> instance 3.2.60 (quelques fichiers PHP légers, contrairement à l'archive
> complète de 31 Mo) — je mettrai la doc à jour au mot près.
