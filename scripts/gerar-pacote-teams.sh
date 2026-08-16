#!/usr/bin/env bash
# Gera o pacote do app do Teams (public/sp-connect-teams.zip) a partir de
# teams-app/. O zip precisa ter os 3 arquivos NA RAIZ (sem pasta) — zip com
# subpasta é recusado pela validação do Teams.
set -euo pipefail
cd "$(dirname "$0")/../teams-app"
rm -f ../public/sp-connect-teams.zip
zip -j ../public/sp-connect-teams.zip manifest.json color.png outline.png
echo "ok → public/sp-connect-teams.zip"
