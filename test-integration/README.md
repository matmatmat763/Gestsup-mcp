# Harnais de test d'intégration

Exerce **tous les endpoints d'écriture** du plugin `gestsup_mcp` contre une
instance GestSup réelle et vérifie l'état en base (relecture) **et les mails**
(collecteur SMTP). Sert à **revalider après une mise à jour de GestSup**
(cf. [`../docs/maintenance-gestsup-updates.md`](../docs/maintenance-gestsup-updates.md)).

> Contrairement aux tests unitaires (`npm test`, réseau simulé), ce harnais
> appelle un **vrai** GestSup. Il n'écrit que sur des tickets qu'il crée.

> 🤖 **La CI exécute ce harnais automatiquement** à chaque push (job
> `integration` de [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) :
> elle monte le stack Docker, démarre le collecteur SMTP et lance `run.mjs`.
> La marche à suivre ci-dessous reste utile pour rejouer le scénario en local.

## Pré-requis

- `npm run build` (le harnais importe `../dist/`)
- Une instance GestSup avec le **plugin `gestsup_mcp` activé** (le stack
  [`../docker/`](../docker/) le fait automatiquement)
- `pip install aiosmtpd`

## Marche à suivre

1. **Lancer l'instance** (stack docker recommandé) :
   ```bash
   cd ../docker && ./fetch-source.sh && docker compose up -d --build
   ```

2. **Démarrer le collecteur SMTP** et y pointer GestSup :
   ```bash
   python3 smtpsink.py        # écoute 127.0.0.1:1025 -> /tmp/smtp_caught.txt
   ```
   Configurer l'instance pour l'utiliser (SMTP en `IsSMTP()`, I majuscule) —
   par exemple sur le stack docker :
   ```bash
   docker compose exec db mariadb -ugestsup -pgestsup gestsup -e \
     "UPDATE tparameters SET mail=1, mail_smtp='host.docker.internal', mail_port=1025, \
      mail_smtp_class='IsSMTP()', mail_secure='', mail_auth='' WHERE id=1;"
   ```
   (En PHP+MariaDB local, `mail_smtp='127.0.0.1'`.)

3. **Lancer le harnais** :
   ```bash
   npm run build
   GESTSUP_BASE_URL=https://localhost:8443 \
   GESTSUP_API_KEY=TESTKEY_local_dev_0123456789abcdef \
   GESTSUP_DEFAULT_USER_ID=10 GESTSUP_INSECURE_TLS=true \
   node test-integration/run.mjs
   ```

   Sortie attendue : une série de `PASS`, puis `# Résultat : N PASS / 0 FAIL`
   (code de sortie 0). Tout `FAIL` pointe l'endpoint à corriger.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `GESTSUP_BASE_URL` | `https://localhost:8443` | Instance cible |
| `GESTSUP_API_KEY` | clé de test docker | Clé API |
| `GESTSUP_DEFAULT_USER_ID` | `10` | Technicien acteur |
| `GESTSUP_INSECURE_TLS` | `true` | Certificat auto-signé local |
| `REQUESTER_EMAIL` | `marie@demo.local` | Demandeur (pour le mail) |
| `TECH2_ID` | `11` | Technicien d'affectation |
| `RESOLVED_STATE` | `3` | Convention interne « résolu » de GestSup |
| `SMTP_FILE` | `/tmp/smtp_caught.txt` | Fichier du collecteur |

## Ce qui est vérifié

Création complète → commentaire public (**mail demandeur**) → note interne
(**sans mail**) → affectation → mise à jour priorité → changement d'état →
clôture conforme (**cause en fin de description**, ticket résolu) → refus de
clôture non conforme → **documentation Obsidian** (vault temporaire) : qualité
du ticket réel jugée documentable, génération + écriture de l'article KB,
recherche plein-texte, et **détection de doublon** (ticket déjà documenté).

> La section documentation exerce les modules compilés (`quality`, `docTemplate`,
> `similar`, `vault`) sur le ticket réellement clôturé, dans un dossier temporaire
> nettoyé en fin de run (aucune dépendance à Obsidian).
