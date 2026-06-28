# Plugin GestSup `gestsup_mcp` — API étendue (lecture)

Plugin serveur qui **ajoute des endpoints API en lecture** à GestSup, pour
combler les manques de l'API native. Prototype : **recherche / liste de tickets
avec filtres** (notamment **par technicien**), ce que l'API officielle ne sait
pas faire.

> Réutilise la **clé API GestSup existante** (même sécurité : clé, IP, HTTPS).
> Aucune modification du cœur de GestSup : c'est un dossier de plugin déposé
> dans `plugins/`.

## Installation

1. Copier le dossier `gestsup_mcp/` dans le répertoire `plugins/` de votre
   instance GestSup :
   ```
   <gestsup>/plugins/gestsup_mcp/
   ```
2. Enregistrer le plugin en base en exécutant `_SQL/install.sql` (via phpMyAdmin
   ou en ligne de commande MySQL), **ou** en le plaçant simplement dans
   `plugins/` puis en l'activant depuis l'interface (selon votre mécanisme de
   store de plugins).
3. Aller dans **Administration → Paramètres → Plugins** et **activer** le plugin
   « MCP / API étendue ».
4. Vérifier que l'**API est activée** (Administration → Paramètres →
   Connecteurs → API) et que vous disposez de la **clé**.

> Le plugin doit être **activé** (`tplugins.enable = 1`) pour répondre, sinon il
> renvoie `403`.

## Endpoint

### `GET /plugins/gestsup_mcp/tickets.php`

Liste/recherche de tickets. **Lecture seule.**

**Authentification** : header `X-API-KEY: <clé>` (ou Basic), HTTPS obligatoire,
IP autorisée si liste blanche configurée — exactement comme l'API native.

**Paramètres (query string, tous optionnels)**

| Param | Type | Description |
|---|---|---|
| `technician` | int | Filtre sur le technicien assigné (`tincidents.technician`) |
| `technician_group` | int | Filtre sur le groupe technicien (`t_group`) |
| `state` | int | Filtre sur l'état |
| `category` | int | Filtre sur la catégorie |
| `subcat` | int | Filtre sur la sous-catégorie |
| `user` | int | Filtre sur le demandeur |
| `keywords` | string | Recherche dans titre + description |
| `date_from` | `YYYY-MM-DD` | Date de création min |
| `date_to` | `YYYY-MM-DD` | Date de création max |
| `order` | enum | `id` \| `date_create` \| `date_modif` \| `state` \| `priority` (défaut `date_create`) |
| `sort` | enum | `ASC` \| `DESC` (défaut `DESC`) |
| `limit` | int | Nombre de lignes (défaut 50, max 200) |
| `offset` | int | Décalage de lignes **réel** (≠ piège de l'API native) |

**Réponse 200**
```json
{
  "code": 0,
  "type": "success",
  "action": "TicketList",
  "count": 2,
  "total": 37,
  "limit": 50,
  "offset": 0,
  "tickets": [
    {
      "ticket_id": "1234",
      "title": "...",
      "state_id": "5", "state_name": "Nouveau",
      "type_id": "1", "type_name": "Incident",
      "category_id": "3", "subcat_id": "7",
      "technician_id": "12", "technician_name": "Jean Dupont",
      "user_id": "42", "requester_name": "Marie Martin",
      "date_create": "2025-02-01 10:00:00",
      "date_modif": "2025-02-02 09:00:00",
      "priority": "2", "criticality": "1"
    }
  ]
}
```

**Exemples**
```bash
# Tickets assignés au technicien 12, les plus récents
curl "https://serveur/plugins/gestsup_mcp/tickets.php?technician=12&order=date_create&sort=DESC&limit=20" \
  -H "X-API-KEY: VOTRE_CLE"

# Recherche globale par mot-clé
curl "https://serveur/plugins/gestsup_mcp/tickets.php?keywords=imprimante&limit=50" \
  -H "X-API-KEY: VOTRE_CLE"
```

### `POST /plugins/gestsup_mcp/ticket_comment.php`

Ajoute un commentaire à un ticket — **public** ou **note interne** — en
répliquant fidèlement `core/ticket.php` (insert `tthreads` type 0 + `date_modif`
+ `userread`) **et** en déclenchant la **notification native** de GestSup
(`core/auto_mail.php`) selon tes paramètres `mail_auto_*`.

**Authentification** : clé API + identité du technicien.

**Paramètres (form / urlencoded)**

| Param | Requis | Description |
|---|---|---|
| `author_id` | ✅ | ID du technicien auteur (= `GESTSUP_DEFAULT_USER_ID` côté MCP) |
| `ticket_id` | ✅ | Numéro du ticket |
| `text` | ✅ | Texte du commentaire |
| `private` | ❌ | `1` = note interne (invisible du demandeur, **aucun mail**). Défaut `0`. |
| `time` | ❌ | Temps passé (minutes) consigné sur le commentaire |
| `notify` | ❌ | Pour un commentaire public : notifier le demandeur. Défaut `1`. |

- **Commentaire public** → le demandeur reçoit le **mail natif** (sujet/template
  GestSup), exactement comme via l'interface ; GestSup journalise aussi le
  thread « mail envoyé ».
- **Note interne** (`private=1`) → enregistrée sans aucune notification.

Le mail n'est envoyé que si le **connecteur SMTP est configuré** (même garde que
`core/ticket.php`). L'écriture est **transactionnelle** et l'endpoint renvoie
l'état (`thread_id`, `private`, `notified`, `mail`).

### `GET /plugins/gestsup_mcp/referentials.php`

Listes de référence **définies par l'instance** (aucune valeur codée en dur).

| Param `kind` | Renvoie (depuis la base) |
|---|---|
| `state` | États (`tstates`) : id, name, number, meta, hidden |
| `priority` | Priorités (`tpriority`) : id, name, number, color |
| `criticality` | Criticités (`tcriticality`) : id, name, number, color |
| `cause` | Causes de résolution (`ttypes_answer`, non désactivées) |
| `group` | Groupes de techniciens (`tgroups`, non désactivés) |
| `technician` | Utilisateurs autorisés comme techniciens (droit `ticket_tech` de l'instance) |
| `procedure` | Procédures de résolution (`tprocedures`) ; filtre optionnel `&category=<id>` |

```bash
curl "https://serveur/plugins/gestsup_mcp/referentials.php?kind=state" -H "X-API-KEY: CLE"
```

### `POST /plugins/gestsup_mcp/ticket_state.php`

Change l'état d'un ticket (résoudre, rejeter, en cours…). L'état est un **id de
la liste de l'instance** (cf. `referentials.php?kind=state`). Réplique
`core/ticket.php` : thread type 5 (changement) ou type 4 (clôture) + `date_res`,
puis **notification native**.

| Param | Requis | Description |
|---|---|---|
| `author_id` | ✅ | Technicien auteur |
| `ticket_id` | ✅ | Numéro du ticket |
| `state_id` | ✅ | État cible (id existant dans `tstates`) |
| `text` | ❌ | Commentaire/résolution joint |
| `private` | ❌ | `1` = note interne |
| `time` | ❌ | Temps passé (minutes) |
| `notify` | ❌ | Notifier le demandeur (défaut `1`) |

> Convention interne de GestSup répliquée : l'état **id 3 = « résolu »** déclenche
> la date de résolution et la notification de clôture (comme le contrôleur natif).
> Le reste des états/valeurs n'est jamais codé en dur : tout vient de l'instance.

### `POST /plugins/gestsup_mcp/ticket_assign.php`

Affecte un ticket à un **technicien** OU à un **groupe** (ids de l'instance).
Réplique `core/ticket.php` : historique type 1 (attribution) ou type 2
(transfert) selon la transition, bump d'état natif « Non attribué » → « Attente
PEC », puis **notification d'attribution native**.

| Param | Requis | Description |
|---|---|---|
| `author_id` | ✅ | Technicien auteur |
| `ticket_id` | ✅ | Numéro du ticket |
| `technician_id` | ✱ | Technicien cible (exclusif avec `group_id`) |
| `group_id` | ✱ | Groupe cible (exclusif avec `technician_id`) |
| `notify` | ❌ | Notifier l'affectation (défaut `1`) |

✱ Fournir l'un **ou** l'autre. Les ids proviennent de
`referentials.php?kind=technician` / `?kind=group`.

### `POST /plugins/gestsup_mcp/ticket_update.php`

Met à jour des champs « simples » d'un ticket (sans historique dédié dans
GestSup) : `category`, `subcat`, `priority`, `criticality`, `type`, `time`
(temps passé), `time_hope` (temps prévu). Un seul `UPDATE` + `date_modif`, puis
notification native.

| Param | Requis | Description |
|---|---|---|
| `author_id` | ✅ | Technicien auteur |
| `ticket_id` | ✅ | Numéro du ticket |
| `category` / `subcat` / `priority` / `criticality` / `type` | ✱ | IDs **validés contre les référentiels de l'instance** |
| `time` / `time_hope` | ✱ | Minutes (entiers) |
| `notify` | ❌ | Notifier le demandeur (défaut `1`) |

✱ Au moins un champ. Tout id inconnu de l'instance est **refusé** (400).

### `POST /plugins/gestsup_mcp/ticket_close.php`

Clôture **conforme** : exige une **cause** et une **procédure**, sinon refus
(400). La cause est **ajoutée à la toute fin de la description** du ticket ; la
résolution (commentaire + procédure) est consignée ; le ticket passe à l'état
résolu (thread type 4 + `date_res`) puis le demandeur est notifié.

| Param | Requis | Description |
|---|---|---|
| `author_id` | ✅ | Technicien auteur |
| `ticket_id` | ✅ | Numéro du ticket |
| `cause` | ✅ | Cause de résolution (ajoutée en fin de description) |
| `procedure_id` | ✱ | Procédure GestSup (`kind=procedure`) |
| `procedure_text` | ✱ | Procédure en texte libre |
| `resolution` | ❌ | Commentaire de résolution additionnel |
| `time` | ❌ | Temps passé (minutes) |
| `notify` | ❌ | Notifier le demandeur (défaut `1`) |

✱ Fournir `procedure_id` **et/ou** `procedure_text` (au moins un).

## Sécurité

- Mêmes contrôles que l'API native (clé API, HTTPS/443, liste blanche d'IP) +
  vérification que le plugin est activé.
- **Lecture seule** : aucune écriture en base.
- Toutes les valeurs sont **liées via requêtes préparées** (PDO) ; le tri/sens
  utilise une **liste blanche stricte** (aucune injection possible).

## Désinstallation

Exécuter `_SQL/uninstall.sql` puis supprimer le dossier (ou utiliser la
désinstallation depuis l'interface des plugins).

## Roadmap (prochaines étapes, écriture)

Endpoints d'écriture à ajouter en répliquant fidèlement la logique GestSup
(historique `tthreads`, notifications mail, dates) :
- changer l'état / clôturer un ticket,
- affecter un ticket à un technicien / groupe,
- (éventuellement) ajouter d'autres lectures (détail enrichi, statistiques).
