#!/usr/bin/env bash
# Gera um número de versão novo e grava no index.html e no version.json.
# Rode antes de cada commit que muda o site: ./tools/versao.sh
set -e
cd "$(dirname "$0")/.."
V=$(date -u +%Y.%m.%d-%H%M)
sed -i -E "s/const APP_VERSION = \"[^\"]*\";/const APP_VERSION = \"$V\";/" index.html
printf '{"v":"%s"}\n' "$V" > version.json
echo "versão $V"
