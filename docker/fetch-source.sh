#!/usr/bin/env bash
#
# Récupère le code source de GestSup dans web/src/ et le schéma SQL dans
# db/init/00-skeleton.sql, nécessaires au build de l'image Docker.
#
# Usage : ./fetch-source.sh [version]
#   - essaie d'abord le téléchargement officiel (gestsup.fr) pour la version
#     demandée (défaut 3.2.60) ;
#   - à défaut, bascule sur le mirroir public GitHub (3.2.55).
#
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-3.2.60}"
DEST_SRC="web/src"
DEST_SQL="db/init/00-skeleton.sql"
TMP="$(mktemp -d)"
# Le zip officiel contient des dossiers en lecture seule (vendor/…) : il faut
# les rendre inscriptibles avant de pouvoir les supprimer.
trap 'chmod -R u+rwX "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "==> Récupération du code source GestSup ($VERSION)"

got_source=0
# 1) Téléchargement officiel
if curl -fsSL "https://gestsup.fr/index.php?page=download&channel=stable&version=${VERSION}&type=gestsup" -o "$TMP/gs.zip" 2>/dev/null; then
  if command -v unzip >/dev/null && unzip -tq "$TMP/gs.zip" >/dev/null 2>&1; then
    mkdir -p "$TMP/src"
    unzip -q "$TMP/gs.zip" -d "$TMP/src"
    # Si l'archive contient un unique sous-dossier, on s'y place
    inner="$(find "$TMP/src" -maxdepth 1 -mindepth 1 -type d | head -1)"
    if [ -f "$TMP/src/connect.php" ]; then SRC_ROOT="$TMP/src";
    elif [ -n "$inner" ] && [ -f "$inner/connect.php" ]; then SRC_ROOT="$inner";
    else SRC_ROOT="$TMP/src"; fi
    got_source=1
    echo "    source officielle OK"
  fi
fi

# 2) Fallback : mirroir GitHub (3.2.55)
if [ "$got_source" -eq 0 ]; then
  echo "    téléchargement officiel indisponible -> fallback mirroir GitHub (3.2.55)"
  curl -fsSL "https://codeload.github.com/DeltaForce53/gestsup-3.2.55/tar.gz/refs/heads/main" -o "$TMP/gs.tgz"
  mkdir -p "$TMP/src"
  tar -xzf "$TMP/gs.tgz" -C "$TMP/src" --strip-components=1
  SRC_ROOT="$TMP/src"
fi

if [ ! -f "$SRC_ROOT/_SQL/skeleton.sql" ]; then
  echo "ERREUR : skeleton.sql introuvable dans la source récupérée." >&2
  exit 1
fi

echo "==> Installation dans $DEST_SRC et $DEST_SQL"
if [ -d "$DEST_SRC" ]; then chmod -R u+rwX "$DEST_SRC" 2>/dev/null || true; fi
rm -rf "$DEST_SRC"
mkdir -p "$DEST_SRC" "$(dirname "$DEST_SQL")"
cp -a "$SRC_ROOT/." "$DEST_SRC/"
# Normalise les permissions (mêmes dossiers lecture seule que dans l'archive) :
# nécessaire pour la copie du plugin ci-dessous et les relances du script.
chmod -R u+rwX "$DEST_SRC"
cp "$SRC_ROOT/_SQL/skeleton.sql" "$DEST_SQL"

# Installe le plugin gestsup_mcp dans la source (auto-installé dans le stack)
if [ -d ../plugin/gestsup_mcp ]; then
  mkdir -p "$DEST_SRC/plugins"
  rm -rf "$DEST_SRC/plugins/gestsup_mcp"
  cp -a ../plugin/gestsup_mcp "$DEST_SRC/plugins/gestsup_mcp"
  echo "    plugin gestsup_mcp copié dans la source (activé via db/init/30-gestsup-mcp.sql)"
fi

echo "==> Terminé. Lancez maintenant :  docker compose up -d --build"
