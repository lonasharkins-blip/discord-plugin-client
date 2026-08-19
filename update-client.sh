#!/bin/bash
set -e

cd "$HOME/DiscordPluginClient"

echo "🔨 Compilando..."
npm run build

echo "📦 Atualizando código-fonte..."
git add -A

if ! git diff --cached --quiet; then
    git commit -m "Update client"
fi

git push origin main

echo "🌐 Publicando bundle..."

TMP="$(mktemp -d)"

git clone \
    --depth 1 \
    --branch dist \
    https://github.com/lonasharkins-blip/discord-plugin-client.git \
    "$TMP"

cp dist/kettu.js "$TMP/kettu.js"

cd "$TMP"

git config user.name "Lona"
git config user.email "lonasharkins@gmail.com"

git add kettu.js

if ! git diff --cached --quiet; then
    git commit -m "Update client bundle"
    git push origin dist
else
    echo "Bundle não mudou."
fi

cd "$HOME/DiscordPluginClient"
rm -rf "$TMP"

echo
echo "✅ Client atualizado e publicado."
