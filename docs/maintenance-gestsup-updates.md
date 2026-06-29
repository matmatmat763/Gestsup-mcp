# Runbook — Suivre les mises à jour de GestSup

Procédure destinée à **mettre à jour le plugin `gestsup_mcp` et le serveur MCP
lorsqu'une nouvelle version de GestSup sort**. Pensée pour être exécutée par un
agent (ou un humain) en autonomie.

> **Version de référence actuellement validée : GestSup 3.2.55.**
> Mettez à jour cette ligne (et la `@Version` des fichiers du plugin) après
> chaque revalidation réussie.

---

## 1. Principe (à garder en tête)

Le plugin suit la **« Voie A »** :

1. **Il réplique** la logique d'écriture native de GestSup (mêmes `INSERT`/`UPDATE`,
   mêmes types d'historique `tthreads`, mêmes règles de dates).
2. **Il réutilise** le moteur de mail natif (`core/auto_mail.php`) pour des
   notifications identiques à l'interface.

➡️ **Conséquence** : une mise à jour de GestSup peut nous impacter si elle change
**(a)** le schéma des tables qu'on écrit, **(b)** la logique du contrôleur qu'on
réplique, **(c)** le contexte/branche de `auto_mail.php`, **(d)** une convention
interne (id d'état, valeur d'un droit), ou **(e)** l'API native.

La règle d'or : **ne jamais coder en dur** une valeur de liste (états, priorités,
catégories, techniciens, procédures…). Si une mise à jour introduit une nouvelle
liste, elle doit être **lue de l'instance** (référentiel), pas figée.

---

## 2. Carte des dépendances (quoi vérifier, et comment le retrouver)

Les **numéros de ligne changent entre versions** : on s'appuie sur des **motifs
`grep`** pour relocaliser chaque point dans la nouvelle source. Depuis la racine
de la nouvelle source GestSup :

### 2.1 Schéma (`_SQL/skeleton.sql`)
Vérifier que les colonnes qu'on écrit existent toujours, mêmes noms/sens :

```bash
# Tables écrites par le plugin
for t in tincidents tthreads tusers tstates tpriority tcriticality ttypes \
         ttypes_answer tcategory tsubcat tplaces tgroups trights tprocedures \
         tparameters tplugins; do
  echo "== $t =="; awk "/CREATE TABLE \`$t\`/{f=1} f{print} /ENGINE=/{if(f)exit}" _SQL/skeleton.sql | grep -E "^\s*\`"
done
```
Colonnes critiques : `tincidents`(user,type,type_answer,technician,t_group,title,
description,date_create,date_modif,date_hope,date_res,priority,criticality,state,
creator,time,time_hope,category,subcat,techread,userread,place,disable),
`tthreads`(ticket,date,author,text,type,tech1,tech2,group1,group2,state,private,time),
`tparameters`(api,api_key,api_client_ip,server_url,mail*,mail_auto*,
ticket_default_state,mail_smtp_class).

### 2.2 Logique du contrôleur (`core/ticket.php`)

| Plugin | Comportement natif répliqué | Motif `grep` pour le retrouver |
|---|---|---|
| `ticket_comment.php` | Insert commentaire (type 0 + private + time) ; `userread=0` si tech | `grep -n "INSERT INTO \`tthreads\`.*private.*time" core/ticket.php` |
| `ticket_state.php` | Thread changement d'état (type 5) | `grep -n "type\`,\`state\`) VALUES.*'5'" core/ticket.php` |
| `ticket_state.php` / `ticket_close.php` | Thread clôture (type 4) + `date_res` | `grep -n "VALUES (:ticket,:date,:author,'4')" core/ticket.php` ; `grep -n "date_res" core/ticket.php` |
| `ticket_assign.php` | Attribution (type 1) / transfert (type 2) | `grep -n "'1',:tech1\|'1',:group1\|'2',:tech1\|'2',:group1" core/ticket.php` |
| `ticket_assign.php` | Bump état « Non attribué » → « Attente PEC » | `grep -n "AUTO CHANGE STATE.*5 to 1" core/ticket.php` |
| `ticket_update.php` | `UPDATE tincidents SET ... ` (colonnes) | `grep -n "UPDATE \`tincidents\` SET" core/ticket.php` |
| `ticket_create.php` | `INSERT INTO tincidents (...)` + `creator`, `state` par défaut | `grep -n "INSERT INTO \`tincidents\`" core/ticket.php` ; `grep -n "ticket_default_state" core/ticket.php` |

Pour chaque point : ouvrir le bloc, vérifier que les colonnes/conditions
correspondent au plugin. Si la logique a changé, adapter le fichier du plugin.

### 2.3 Notifications (`core/auto_mail.php`, `core/mail.php`)

Le plugin reconstruit le contexte attendu par `auto_mail.php` puis l'inclut.
Vérifier :

```bash
# Garde d'accès + variables de contexte attendues
grep -n "isset(\$_SESSION\['user_id'\])" core/auto_mail.php
grep -noE "\$rparameters\['[a-z_]+'\]|\$globalrow\['[a-z_]+'\]|\$_POST\['[a-z_]+'\]|\$_GET\['[a-z_]+'\]" core/auto_mail.php | sort -u
# Branches de notification (qui est notifié, selon quels params/flags)
grep -n "mail_auto_tech_attribution\|mail_auto'\|mail_auto_user_modify\|mail_auto_user_newticket\|\$_POST\['state'\]=='3'" core/auto_mail.php
# Mailer : sélection SMTP (ATTENTION à la casse de 'IsSMTP()')
grep -n "IsSMTP()\|->Host\|->Port\|->SMTPAuth\|->send(" core/mail.php
```

Points de vigilance déjà rencontrés (à reconfirmer à chaque version) :
- `auto_mail.php` exige `$_SESSION['user_id']`, `$_SESSION['profile_id']`,
  `$rparameters` (complet), `$globalrow`, `$ruser`, `$datetime`,
  `$_GET['action']` / `$_POST['action']`. → assurés par `write_init.php`
  (`mcp_native_notify`). Si de nouvelles variables apparaissent, les initialiser.
- `auto_mail.php`/`message.php`/`mail.php` utilisent `T_()` et `LOCALE_DIR` →
  fournis via `include('./localization.php')` (avec `$ruser['language']` et
  `chdir(racine)`). Vérifier que `localization.php` n'a pas changé de contrat.
- `core/mail.php` teste `mail_smtp_class == 'IsSMTP()'` (**I majuscule**). Si la
  casse/valeur change, ajuster la config de test.

### 2.4 Conventions internes couplées (répliquées, pas inventées)
À reconfirmer (le contrôleur GestSup les code en dur) :
- **État `3` = « résolu »** (déclenche `date_res` + clôture). Cf. `GS_STATE_RESOLVED`.
- **État `5` = « Non attribué »** (bump → `1` à l'attribution). Cf. `GS_STATE_UNASSIGNED`.
- **Droit `ticket_tech`** est multi-valeur (`0`/`2`…) → le référentiel `technician`
  filtre `ticket_tech != 0` (pas `=1`).

```bash
grep -n "state\(\| \)*==\(\| \)*'\?3'\?\|state.*5\|t_group.*5\|profile_id==4" core/ticket.php | head
```

### 2.5 API native (`api/v1/`)
Pour les lectures via l'API native (`gestsup_list_referential` type/category/
subcat/place, get/find/user) :

```bash
ls api/v1/ api/v1/func/ ; cat api/v1/.htaccess ; cat api/v1/swagger.json
```
Vérifier que les routes et les noms de champs des réponses n'ont pas changé.

---

## 3. Procédure de mise à jour (pas à pas)

1. **Récupérer la nouvelle source** (sur une machine avec accès `gestsup.fr`,
   ou via un mirroir) et l'extraire.
2. **Diff schéma** (§2.1). Si une colonne qu'on écrit a disparu/changé → adapter
   le plugin.
3. **Diff logique** (§2.2 à §2.4) via les `grep`. Pour chaque écart, mettre à jour
   le fichier du plugin concerné.
4. **Diff API native** (§2.5) si on touche aux lectures.
5. **Revalider** avec le harnais (§4) sur une instance de la **nouvelle** version.
6. **Bumper** la version de référence (ce fichier) et les `@Version` du plugin ;
   `npm test` ; commit.

---

## 4. Revalidation : le harnais de test d'intégration

Le dossier [`../test-integration/`](../test-integration/) contient un harnais
**réutilisable** qui exerce **tous** les endpoints d'écriture contre une instance
réelle et **capture les mails** (collecteur SMTP), pour prouver l'équivalence.

Méthode (détaillée dans son README) :
1. Démarrer une instance de la nouvelle version (le stack `docker/` fait foi, ou
   PHP+MariaDB). Activer/installer le plugin (auto dans le stack Docker).
2. Lancer le collecteur SMTP et pointer `tparameters.mail_smtp` dessus.
3. `node test-integration/run.mjs` → exécute commentaire (public + interne),
   changement d'état/résolution, affectation (attribution + transfert), mise à
   jour de champs, clôture conforme, création complète — et **vérifie** l'état en
   base + les **mails capturés**.
4. Tout doit être `PASS`. Sinon, le message indique l'endpoint à corriger.

> Idéalement, comparer aussi une action faite **via l'interface GestSup** et la
> même **via le plugin** sur deux tickets jumeaux, puis diff `tincidents`/`tthreads` :
> c'est la preuve ultime d'équivalence après une montée de version.

---

## 5. Checklist express (copier dans la PR de mise à jour)

- [ ] Schéma des tables écrites inchangé (ou plugin adapté)
- [ ] Historique `tthreads` (types 0/1/2/4/5) inchangé
- [ ] `UPDATE`/`INSERT` `tincidents` : colonnes inchangées
- [ ] Contexte/branches `auto_mail.php` inchangés (ou `mcp_native_notify` adapté)
- [ ] `mail.php` : sélection SMTP (`IsSMTP()`) inchangée
- [ ] Conventions d'état (3 résolu, 5 non attribué) toujours valides
- [ ] Droit `ticket_tech` (filtre `!=0`) toujours valide
- [ ] API native (routes + champs) inchangée
- [ ] `node test-integration/run.mjs` = tous `PASS` (mails capturés inclus)
- [ ] `npm test` vert ; version de référence + `@Version` plugin bumpées
