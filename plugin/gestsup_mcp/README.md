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
