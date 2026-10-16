#!/usr/bin/env sh
# One-click start for macOS and Linux: installs on first run, then starts MagicFinder.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "MagicFinder needs Node.js 22.13 or newer. Install it from https://nodejs.org and run this again."
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "MagicFinder needs Node.js 22.13 or newer (you have $(node -v)). Update it from https://nodejs.org."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: installing (this takes a minute)…"
  npm install || exit 1
fi
npm start
