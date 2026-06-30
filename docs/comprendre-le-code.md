# Comprendre le code — guide de lecture

But de ce guide : te rendre **capable d'expliquer, avec tes mots**, ce que fait
le code et **pourquoi**, pour le défendre en revue/production. Tu n'as **pas**
besoin de savoir l'écrire — juste de le **lire** et le raconter.

> Méthode conseillée : pour chaque fichier ci-dessous, (1) lis ma résumé, (2)
> ouvre le vrai fichier à côté, (3) **referme ce guide et réexplique à voix
> haute**. Si tu y arrives, c'est gagné.

---

## 1. Le vocabulaire minimum (à connaître)

| Mot | En clair |
|---|---|
| **fichier** `.ts` / `.php` / `.sql` | Un document de code. `.ts` = TypeScript (le serveur), `.php` = le plugin GestSup, `.sql` = la base de données. |
| **fonction** | Une « recette » qui prend des entrées et rend un résultat. Mot-clés : `function`, `=>`, `async`. |
| **variable** | Une étiquette qui range une valeur. Mot-clés : `const` (fixe), `let` (modifiable). |
| **import** | « J'utilise du code écrit ailleurs. » En haut des fichiers. |
| **type** / `interface` | Une description de la forme d'une donnée (ex. un ticket a un titre, un état…). Sert à éviter les erreurs. |
| **`async` / `await`** | Pour les actions qui prennent du temps (appel réseau, lecture fichier). « attends le résultat avant de continuer ». |
| **test** (fichier `*.test.ts`) | Du code qui **vérifie automatiquement** que le vrai code fait ce qu'on attend. C'est ta meilleure preuve de sérieux. |
| **requête préparée** (SQL) | Une façon **sûre** d'interroger la base : les valeurs sont séparées de la commande → pas d'injection possible. |

Si tu sais reconnaître ces 8 mots, tu peux lire 90 % du projet.

---

## 2. La carte du projet (où est quoi)

```
src/            ← le "traducteur" (serveur MCP, en TypeScript)
  index.ts        démarrage : lit la config, branche les outils, attend les requêtes
  config.ts       lit les réglages (URL, clé API, dossier Obsidian) et les vérifie
  gestsupClient.ts parle à GestSup (les appels réseau)
  normalize.ts    nettoie les données reçues de GestSup
  tools.ts        définit les 20 "outils" que l'IA peut utiliser
  quality.ts      note si un ticket est assez riche pour être documenté
  similar.ts      détecte si un cas identique est déjà documenté (anti-doublon)
  docTemplate.ts  met un ticket en forme d'article de doc
  vault/          lecture/écriture des notes Obsidian (fichiers .md)

plugin/gestsup_mcp/  ← la "rallonge" ajoutée à GestSup (en PHP)
  init.php          sécurité commune (clé API, HTTPS, IP, plugin activé)
  write_init.php    socle des écritures (qui agit, droits)
  tickets.php       recherche de tickets
  ticket_*.php      les actions (commenter, clôturer, créer…)

test/            ← les vérifications automatiques (81 tests)
docker/          ← une fausse instance GestSup pour tester (dont les 5000 tickets)
docs/            ← les explications (dont ce fichier)
```

**La phrase à retenir** : *« Le serveur `src/` traduit ce que demande l'IA en
actions ; le plugin PHP ajoute à GestSup les fonctions qui lui manquent ; les
tests prouvent que ça marche. »*

---

## 3. Lecture commentée de 4 fichiers clés

### 3.1 `src/config.ts` — le plus simple pour commencer

**Ce qu'il fait :** lit les réglages (variables d'environnement) et **refuse de
démarrer si quelque chose est dangereux ou manquant**.

Points à savoir repérer :
- Un **schéma** (`ConfigSchema`) décrit les réglages attendus et leurs valeurs
  par défaut.
- Une règle impose **HTTPS** : `if (!cfg.baseUrl.startsWith("https://")) throw …`
  → « si l'adresse n'est pas en https, on arrête ». *Pourquoi : l'API GestSup
  n'accepte que le port sécurisé.*
- Une règle refuse de **désactiver la sécurité TLS vers un serveur public**
  (`isPrivateHost`) → *protège d'une interception (MITM).*

**Ce que tu dois pouvoir dire :** « Ce fichier lit la configuration et bloque le
démarrage si l'adresse n'est pas sécurisée ou si on tente de désactiver le TLS
ailleurs qu'en local. »

### 3.2 `src/tools.ts` — un outil = une action de l'IA

C'est gros, mais **tous les outils ont la même structure**. Repère le motif :

```ts
server.registerTool(
  "gestsup_create_ticket",     // 1. le nom de l'outil
  { description: "...", inputSchema: { ... } },  // 2. ce qu'il attend
  async (args) => {            // 3. ce qu'il fait quand on l'appelle
    if (!cfg.allowWrites) return fail(...);  // garde-fou (lecture seule ?)
    const r = await client.createTicket(...);// appelle GestSup
    return ok(`Ticket ${r.ticket_id} créé.`);// renvoie un résultat
  },
);
```

**Ce que tu dois pouvoir dire :** « Chaque outil déclare son nom, ses
paramètres, puis une fonction qui vérifie les droits, appelle GestSup, et rend
une réponse. Il y en a 20, tous bâtis pareil. »

> Astuce revue : le bloc `if (!cfg.allowWrites) return fail(...)` est le
> **coupe-circuit d'écriture** — montre-le, ça prouve qu'on peut mettre l'outil
> en lecture seule.

### 3.3 `src/vault/store.ts` — la sécurité des fichiers

**Le point sensible à comprendre :** quand l'IA écrit une note, on doit
empêcher qu'elle écrive **en dehors** du dossier prévu (ex. un fichier système).

Cherche la fonction `resolveInside`. Elle :
1. refuse les chemins absolus et ceux qui contiennent `..` (« remonter d'un
   dossier ») ;
2. vérifie que le chemin final **commence bien par la racine** du dossier.

**Ce que tu dois pouvoir dire :** « Avant toute écriture, on vérifie que le
chemin reste à l'intérieur du dossier autorisé : pas de `..`, pas de chemin
absolu. C'est la protection contre l'évasion de dossier (path traversal). »

### 3.4 `src/quality.ts` — la note de "richesse" d'un ticket

**Ce qu'il fait :** donne un **score de 0 à 100** à un ticket pour dire s'il
mérite d'être documenté, à partir de **signaux mesurables** (description assez
longue ? résolution écrite ? ticket clôturé ? type défini ? titre clair ?).

C'est **déterministe** : mêmes données = même score. Aucune « magie ».

**Ce que tu dois pouvoir dire :** « On additionne des points selon des critères
objectifs ; au-dessus d'un seuil (60 par défaut), le ticket est jugé
documentable. C'est transparent et reproductible. »

---

## 4. Le plugin PHP et le SQL (les 2 questions sécurité)

### 4.1 « Et l'injection SQL ? » (le plugin)

Ouvre `plugin/gestsup_mcp/tickets.php`. Montre que les filtres sont **liés** :

```php
$where[] = 'i.technician = :technician';   // un trou nommé
$bind['technician'] = $technician;          // la valeur, à part
```

La valeur n'est **jamais collée** dans la commande SQL → **pas d'injection**.
Le tri utilise une **liste blanche** (seules quelques colonnes autorisées).

**À dire :** « Toutes les valeurs passent par des requêtes préparées, et le tri
est limité à une liste fixe : l'injection SQL est impossible. »

### 4.2 `docker/db/init/40-seed-bulk.sql` — les 5000 tickets de démo

**Ce qu'il fait :** remplit la **fausse** base de test. Ce n'est **pas** du code
de production — juste des données pour tester à grande échelle.

À savoir expliquer :
- `seq_1_to_5000` = une astuce MariaDB qui fournit les nombres 1 à 5000 → on
  crée 5000 lignes d'un coup.
- `RAND()` = du hasard, pour varier état, priorité, technicien, dates.
- `derived_merge=off` = pour que le hasard soit **calculé une seule fois** par
  ligne (sinon les colonnes seraient incohérentes).

**À dire :** « C'est un script qui peuple l'instance de démo avec des données
variées, généré côté base pour être rapide. Ça ne touche pas la production. »

---

## 5. Les tests = ta meilleure preuve

Dans `test/`, chaque fichier vérifie un morceau. Exemple lisible
(`test/quality.test.ts`) :

```ts
it("juge documentable un ticket riche et résolu", () => {
  const r = assessTicketQuality(ticket(), 60);
  expect(r.documentable).toBe(true);   // on AFFIRME le résultat attendu
});
```

`expect(...).toBe(...)` = « je m'attends à ce que ce soit égal à… ». Si ce
n'est pas le cas, le test échoue.

**À dire en revue :** « Il y a 81 tests automatiques. On les lance avec
`npm test`. S'ils passent tous, c'est que le comportement attendu est vérifié. »

Commande à connaître :
```bash
npm test        # lance les 81 tests
npm run lint    # vérifie la propreté du code
```

---

## 6. Les questions probables d'un relecteur (entraîne-toi)

> Cache les réponses et essaie de répondre d'abord.

1. **« À quoi sert ce projet ? »**
   → Piloter les tickets GestSup en langage naturel via une IA, et capitaliser
   les solutions dans une doc Obsidian.

2. **« La clé d'API, elle est protégée ? »**
   → Oui : elle vient d'une variable d'environnement, elle n'est **jamais
   écrite dans les logs**, et tout passe en HTTPS.

3. **« Comment on évite les injections SQL ? »**
   → Requêtes préparées partout, tri en liste blanche (cf. `tickets.php`).

4. **« L'IA peut-elle écrire n'importe où sur le disque ? »**
   → Non : `resolveInside` confine toute écriture dans le dossier autorisé
   (pas de `..`, pas de chemin absolu).

5. **« Et si on veut juste de la lecture ? »**
   → Coupe-circuits : `GESTSUP_ALLOW_WRITES=false` et
   `OBSIDIAN_ALLOW_WRITES=false`.

6. **« Comment je sais que ça marche ? »**
   → 81 tests automatiques (`npm test`) + un harnais d'intégration contre une
   vraie instance (`test-integration/`).

7. **« Ça envoie des données dehors ? »**
   → Non : le seul appel réseau va vers **notre** instance GestSup. Le reste
   (notes) ce sont des fichiers locaux.

---

## 7. Comment t'entraîner (15 min/jour)

1. Ouvre **un** fichier de la section 3.
2. Lis-le lentement, repère le motif décrit ici.
3. Referme, et **explique-le à voix haute** (ou à un collègue) en 3 phrases.
4. Le lendemain, fichier suivant.

En 5 jours, tu as fait le tour des fichiers clés et tu peux répondre aux 7
questions de la section 6. C'est largement suffisant pour montrer que tu
**lis et comprends** le code.
