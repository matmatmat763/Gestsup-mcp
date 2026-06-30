# Stack de test local — GestSup + MariaDB (Docker)

Monte en quelques minutes une instance **GestSup jetable**, pré-remplie de
**données d'exemple** et avec l'**API activée**, pour tester le serveur MCP sur
du « vrai » sans toucher à ta production.

> Le plugin **`gestsup_mcp` est auto-installé et activé** par le stack
> (copié dans la source par `fetch-source.sh`, enregistré par
> `db/init/30-gestsup-mcp.sql`). **Tous les outils MCP** fonctionnent donc,
> écritures comprises. Les notifications mail sont activées : pointez
> `mail_smtp` vers un collecteur SMTP pour les capturer.

## Pré-requis

- Docker + Docker Compose
- Accès Internet (pour récupérer le code GestSup et les images de base)

## Lancement

```bash
cd docker
./fetch-source.sh          # récupère le code GestSup (officiel, sinon mirroir 3.2.55)
docker compose up -d --build
```

Au premier démarrage, MariaDB charge automatiquement :
`00-skeleton.sql` (schéma) → `10-config.sql` (active l'API + clé) →
`20-seed.sql` (petit jeu d'exemple) → `30-gestsup-mcp.sql` (active le plugin) →
`40-seed-bulk.sql` (**gros jeu de données réaliste**, ci-dessous).

## Accès

| Service | URL | Identifiants |
|---|---|---|
| Interface web | http://localhost:8080 | `admin` / `admin` |
| API (HTTPS, auto-signé) | https://localhost:8443/api/v1/ | clé ci-dessous |

**Clé d'API de test** (définie dans `db/init/10-config.sql`) :
```
TESTKEY_local_dev_0123456789abcdef
```

Test rapide en ligne de commande (`-k` car certificat auto-signé) :
```bash
curl -k "https://localhost:8443/api/v1/ticket/type/" -H "X-API-KEY: TESTKEY_local_dev_0123456789abcdef"
```

## Données d'exemple

Petit jeu lisible (`20-seed.sql`) **+** gros jeu réaliste (`40-seed-bulk.sql`) :

- **5 techniciens** : Paul (10), Léa (11), Lucas (12), Sophie (13), Karim (14).
- **~200 demandeurs** (ids 1001–1200) + Marie (20), Jean (21).
- **~5000 tickets** variés : types (Demande/Incident), états répartis
  (Non attribué, Attente PEC, En cours, Résolu, Attente retour, Rejeté),
  priorités, criticités, **5 lieux** (Lyon, Paris, Marseille, Lille, Toulouse),
  **5 catégories** + sous-catégories, dates étalées sur ~1 an.
- **Commentaires** (≈60 % des tickets) et **résolutions** sur les tickets
  résolus/rejetés → de quoi exercer la recherche, les statistiques et la
  documentation (qualité, doublons).
- Référentiels ajoutés : **groupes** Support N1 / N2.
- Mot de passe de tous les comptes de démo : `admin`.

> Le gros jeu est généré côté base (moteur `SEQUENCE` de MariaDB), donc le
> premier démarrage prend quelques secondes de plus.
>
> ⚠️ Les scripts d'init ne s'exécutent **que sur une base vierge**. Si tu avais
> déjà lancé le stack avant cet ajout, repars de zéro :
> `docker compose down -v && docker compose up -d --build`.

## Brancher le serveur MCP dessus

Dans la config de ton client MCP (ex. Claude Desktop) :

```json
{
  "mcpServers": {
    "gestsup-test": {
      "command": "node",
      "args": ["/chemin/vers/Gestsup-mcp/dist/index.js"],
      "env": {
        "GESTSUP_BASE_URL": "https://localhost:8443",
        "GESTSUP_API_KEY": "TESTKEY_local_dev_0123456789abcdef",
        "GESTSUP_DEFAULT_USER_ID": "10",
        "GESTSUP_INSECURE_TLS": "true"
      }
    }
  }
}
```

> `GESTSUP_INSECURE_TLS=true` est **nécessaire ici** (certificat auto-signé) et
> **réservé au test local** — ne l'utilise jamais en production.

## Arrêt / remise à zéro

```bash
docker compose down        # arrête
docker compose down -v     # arrête + efface la base (repart de zéro au prochain up)
```

## Mettre à jour le plugin dans le stack

Le plugin est déjà installé. Après une modification du plugin dans le dépôt,
relancez simplement :

```bash
./fetch-source.sh          # recopie le plugin dans la source
docker compose up -d --build
```

> Pour faire évoluer le plugin/MCP **quand GestSup change de version**, suivez
> le runbook [`docs/maintenance-gestsup-updates.md`](../docs/maintenance-gestsup-updates.md).
