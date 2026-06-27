# Stack de test local — GestSup + MariaDB (Docker)

Monte en quelques minutes une instance **GestSup jetable**, pré-remplie de
**données d'exemple** et avec l'**API activée**, pour tester le serveur MCP sur
du « vrai » sans toucher à ta production.

> Cette étape **n'inclut pas** le plugin `gestsup_mcp` : 6 des 7 outils MCP
> fonctionnent (création/lecture/commentaire/listes). L'outil
> `gestsup_search_tickets` (recherche par technicien) nécessitera d'ajouter le
> plugin ensuite — voir la fin de ce document.

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
`20-seed.sql` (données d'exemple).

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

- **Techniciens** : Paul (id 10), Léa (id 11) — + `admin` (id 1)
- **Demandeurs** : Marie (id 20), Jean (id 21)
- **8 tickets** répartis sur les techniciens, états variés (Attente/En cours/Résolu),
  avec quelques commentaires.
- Mot de passe de tous les comptes de démo : `admin`.

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

## Étape suivante : ajouter le plugin `gestsup_mcp`

Pour tester aussi `gestsup_search_tickets` (recherche par technicien), copier le
plugin dans la source **avant** le build, puis l'activer :

```bash
cp -a ../plugin/gestsup_mcp web/src/plugins/gestsup_mcp
docker compose up -d --build
# activer le plugin (une fois la base initialisée) :
docker compose exec db mariadb -ugestsup -pgestsup gestsup \
  -e "INSERT INTO tplugins (name,label,description,icon,version,enable) VALUES ('gestsup_mcp','MCP','API etendue','robot','0.1',1) ON DUPLICATE KEY UPDATE enable=1;"
```
