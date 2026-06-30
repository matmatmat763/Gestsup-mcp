# Installer mon système — partie par partie

Guide **simple et dans l'ordre**. Quatre parties à installer, puis une
vérification. Pour les détails (commandes de montage par OS, dépannage), voir le
[guide de démarrage](guide-demarrage.md).

```
[A] GestSup (API + plugin)   →   [B] Stockage des notes   →   [C] Serveur MCP   →   [D] Client (Hermes/Claude)
```

Coche chaque case ✅ avant de passer à la suivante.

---

## Partie A — GestSup (le ticketing)

**À quoi ça sert :** c'est la source des tickets. On active son API et on ajoute
le plugin pour débloquer la recherche et les écritures.

**Étapes :**

1. **Activer l'API** : Administration → Paramètres → Connecteurs → onglet **API**.
2. **Générer une clé d'API** et la **noter** (elle servira en partie C).
3. Vérifier l'accès en **HTTPS** (l'API refuse tout port ≠ 443).
4. Si une **liste blanche d'IP** existe : ajouter l'IP de la machine qui fera
   tourner le serveur MCP (partie C).
5. **Installer le plugin** `gestsup_mcp` :
   - copier le dossier [`plugin/gestsup_mcp/`](../plugin/gestsup_mcp/) dans
     `<gestsup>/plugins/gestsup_mcp/` ;
   - l'activer (exécuter `_SQL/install.sql`, **ou** l'activer depuis
     Administration → Paramètres → Plugins).

**✅ C'est bon quand :** tu as une **clé d'API** et le plugin apparaît **activé**.

> Tu veux juste tester sans toucher à ta prod ? Une instance jetable est fournie
> dans [`docker/`](../docker/) (plugin déjà installé).

---

## Partie B — Le stockage des notes (vault Obsidian)

**À quoi ça sert :** c'est l'endroit où la documentation est écrite/lue. Choisis
**une** des deux options.

### Option 1 — Dossier local (le plus simple)

1. Crée un dossier, ex. `~/obsidian` (ou ouvre un vault existant).
2. Retiens ce chemin : il ira dans `OBSIDIAN_VAULT_PATH` (partie C).

### Option 2 — Sur un serveur de fichiers (SMB / NFS)

On **monte** le partage sur la machine du MCP, puis on pointe dessus. Exemple SMB
sous Linux :

```bash
sudo apt install cifs-utils
sudo mkdir -p /mnt/obsidian
sudo mount -t cifs //serveur-fichiers/partage/obsidian /mnt/obsidian \
  -o username=mon_user,uid=$(id -u),gid=$(id -g),iocharset=utf8,vers=3.0
```

(macOS et Windows : voir le [guide de démarrage](guide-demarrage.md#3-optionnel-mettre-le-vault-obsidian-sur-un-serveur-de-fichiers).)
Le chemin (`/mnt/obsidian`) ira dans `OBSIDIAN_VAULT_PATH`.

**✅ C'est bon quand :** tu peux créer un fichier dans le dossier (local ou monté).
La doc est **optionnelle** : sans `OBSIDIAN_VAULT_PATH`, seuls les outils GestSup
sont actifs.

---

## Partie C — Le serveur MCP

**À quoi ça sert :** c'est le pont entre le LLM et GestSup + le vault.

**Étapes :**

```bash
git clone <repo> && cd Gestsup-mcp
npm install
npm run build
```

Prépare les **variables d'environnement** (tu les colleras dans la config du
client en partie D) :

| Variable | Obligatoire | Exemple | Vient de… |
|---|---|---|---|
| `GESTSUP_BASE_URL` | ✅ | `https://support.exemple.fr` | ton instance |
| `GESTSUP_API_KEY` | ✅ | `xxxxxxxx` | **partie A** |
| `GESTSUP_DEFAULT_USER_ID` | ✅ | `1` | l'id du technicien « robot » |
| `OBSIDIAN_VAULT_PATH` | ❌ | `/mnt/obsidian` | **partie B** |
| `OBSIDIAN_DOCS_FOLDER` | ❌ | `KB` | sous-dossier des notes |

Liste complète : [`.env.example`](../.env.example).

**✅ C'est bon quand :** `npm run build` se termine sans erreur (un dossier
`dist/` est créé).

---

## Partie D — Le client (Hermes / Claude Desktop)

**À quoi ça sert :** c'est l'interface où tu parles en langage naturel.

Déclare un serveur MCP **stdio** qui lance `node dist/index.js` avec les
variables de la partie C.

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

Même principe : commande `node /chemin/vers/dist/index.js` + les mêmes variables.
Aucune option MCP spéciale requise (que des **outils**).

**✅ C'est bon quand :** après redémarrage du client, le serveur `gestsup`
apparaît avec ~20 outils.

---

## Vérifier que tout marche

1. **Logs au démarrage** (stderr du serveur) :
   - `Serveur MCP GestSup prêt` ;
   - si vault configuré : `✅ Vault accessible et écrivable`.
2. **Lecture GestSup** : *« Montre-moi le ticket 1. »*
3. **Doc** (si vault) : *« Liste mes notes Obsidian. »* puis *« Note dans la doc : test. »*
4. **Boucle complète** : clôture un ticket → la réponse **propose de documenter**
   (sauf cas similaire déjà en doc).

---

## Mémo dépannage

| Message / symptôme | À vérifier |
|---|---|
| `403` GestSup | API activée ? clé correcte ? HTTPS ? IP en liste blanche ? |
| `405` GestSup | Plugin `gestsup_mcp` installé **et activé** ? |
| « Vault injoignable » | Partage **monté** ? (`mount`, lecteur réseau) |
| « Vault non écrivable » | Droits du montage (option `uid/gid` côté SMB) |
| Outils de doc absents | `OBSIDIAN_VAULT_PATH` défini puis client **redémarré** ? |
| Une modif du code n'apparaît pas | `git pull && npm run build`, puis redémarrer le client |
