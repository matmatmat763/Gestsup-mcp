# Guide de démarrage — GestSup MCP + documentation Obsidian

Brancher le serveur MCP sur **GestSup** et sur un **vault Obsidian** (local ou
sur un **serveur de fichiers** SMB/NFS), en ~10 minutes. Compatible **Hermes
agent**, Claude Desktop, ou tout client MCP (transport stdio).

---

## 1. Pré-requis côté GestSup

1. **API activée** : Administration → Paramètres → Connecteurs → onglet **API**.
2. Une **clé d'API** générée.
3. Accès en **HTTPS** (l'API refuse tout port ≠ 443).
4. Si une **liste blanche d'IP** est configurée, l'IP de la machine qui exécute
   le MCP doit y figurer.
5. Pour les outils étendus (recherche, écritures) : installer le **plugin
   `gestsup_mcp`** (voir [`../plugin/gestsup_mcp/README.md`](../plugin/gestsup_mcp/README.md)).

## 2. Installer le serveur MCP

```bash
git clone <repo> && cd Gestsup-mcp
npm install
npm run build
```

## 3. (Optionnel) Mettre le vault Obsidian sur un serveur de fichiers

Le serveur MCP lit/écrit de **simples fichiers `.md`** : il n'a pas besoin de
« parler SMB ». On **monte** le partage réseau sur la machine du MCP, puis on
pointe `OBSIDIAN_VAULT_PATH` sur le dossier monté. Cela marche pour **SMB, NFS,
WebDAV monté, cloud drive…**, et l'OS gère l'authentification et la reconnexion.

> Le vault peut aussi être **partagé avec l'app Obsidian** : ouvre le même
> dossier monté comme vault dans Obsidian, et tout reste synchronisé (ce sont
> les mêmes fichiers).

### Linux — monter un partage SMB

```bash
sudo apt install cifs-utils
sudo mkdir -p /mnt/obsidian
sudo mount -t cifs //serveur-fichiers/partage/obsidian /mnt/obsidian \
  -o username=mon_user,uid=$(id -u),gid=$(id -g),iocharset=utf8,vers=3.0
# Montage permanent : ajouter une ligne dans /etc/fstab (avec un fichier credentials)
```

Puis : `OBSIDIAN_VAULT_PATH=/mnt/obsidian`.

### Linux — monter un partage NFS

```bash
sudo mount -t nfs serveur-fichiers:/export/obsidian /mnt/obsidian
```

### macOS

```bash
mkdir -p ~/obsidian-share
mount_smbfs //mon_user@serveur-fichiers/partage/obsidian ~/obsidian-share
```
Puis : `OBSIDIAN_VAULT_PATH=/Users/<toi>/obsidian-share`.

### Windows

Mapper un lecteur réseau (ex. `Z:`) vers `\\serveur-fichiers\partage\obsidian`,
puis dans la config MCP utiliser des `/` :
`OBSIDIAN_VAULT_PATH=Z:/` (ou `//serveur-fichiers/partage/obsidian`).

> **Bon à savoir** : au démarrage, le serveur **vérifie que le vault est
> joignable** et l'indique dans ses logs (stderr). Si le partage n'est pas
> monté, les outils de doc renvoient un message clair (« vault injoignable — le
> partage réseau est-il monté ? ») sans planter les outils GestSup.

## 4. Configurer (variables d'environnement)

| Variable | Requis | Exemple | Rôle |
|---|---|---|---|
| `GESTSUP_BASE_URL` | ✅ | `https://support.exemple.fr` | Instance GestSup (HTTPS). |
| `GESTSUP_API_KEY` | ✅ | `xxxxxxxx` | Clé d'API (**secret**). |
| `GESTSUP_DEFAULT_USER_ID` | ✅* | `1` | Technicien auteur des écritures. |
| `OBSIDIAN_VAULT_PATH` | ❌ | `/mnt/obsidian` | **Active** la doc ; dossier (monté) du vault. |
| `OBSIDIAN_DOCS_FOLDER` | ❌ | `KB` | Sous-dossier des notes générées. |
| `OBSIDIAN_ALLOW_WRITES` | ❌ | `true` | `false` = doc en lecture seule. |
| `GESTSUP_DOC_QUALITY_THRESHOLD` | ❌ | `60` | Score min. pour juger un ticket « documentable ». |

\* Requis pour les écritures. Liste complète : [`../.env.example`](../.env.example).

## 5. Brancher sur le client MCP

### Claude Desktop — `claude_desktop_config.json`

```json
{
  "mcpServers": {
    "gestsup": {
      "command": "node",
      "args": ["/chemin/absolu/vers/Gestsup-mcp/dist/index.js"],
      "env": {
        "GESTSUP_BASE_URL": "https://support.exemple.fr",
        "GESTSUP_API_KEY": "votre-cle",
        "GESTSUP_DEFAULT_USER_ID": "1",
        "OBSIDIAN_VAULT_PATH": "/mnt/obsidian"
      }
    }
  }
}
```

### Hermes (ou autre client MCP)

Même principe : déclarer un serveur stdio dont la commande est
`node /chemin/vers/dist/index.js`, avec les mêmes variables d'environnement.
Aucune fonctionnalité MCP optionnelle n'est requise (pas de `resources` /
`prompts` / `sampling`) : seuls les **outils** sont utilisés.

## 6. Vérifier que tout marche

1. Lance le client : la connexion au serveur `gestsup` doit lister ~20 outils.
   Les logs (stderr) doivent afficher `✅ Vault accessible et écrivable` si un
   vault est configuré.
2. Test lecture : *« Montre-moi le ticket 1. »*
3. Test doc : *« Liste mes notes Obsidian. »* puis *« Note dans la doc : test. »*

## 7. Cycle de travail type

1. Traiter un ticket (consulter, commenter, affecter, mettre à jour).
2. **Clôturer** : *« Résous le 1234 : … cause : … »* — la réponse **propose
   de documenter**, sauf si un cas similaire avec la même résolution existe déjà.
3. Si proposé et pertinent : *« Documente-le »* → un article KB est créé dans le
   vault (sur ton serveur de fichiers).
4. Plus tard : *« A-t-on déjà eu ce problème ? »* → recherche dans la doc.

## 8. Dépannage rapide

| Symptôme | Piste |
|---|---|
| `403` GestSup | API activée ? clé correcte ? HTTPS ? IP en liste blanche ? |
| `405` GestSup | Endpoint indisponible : le **plugin** est-il installé/activé ? |
| « Vault injoignable » | Le partage réseau est-il **monté** ? (`mount` / lecteur réseau) |
| « Vault non écrivable » | Droits du montage (option `uid/gid` côté SMB). |
| Outils de doc absents | `OBSIDIAN_VAULT_PATH` est-il défini puis le client redémarré ? |
| Modifs non prises en compte | `git pull && npm run build`, puis redémarrer le client. |
