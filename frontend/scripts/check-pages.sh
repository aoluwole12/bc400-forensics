#!/usr/bin/env bash
set -euo pipefail

bad=$(find src/pages -maxdepth 1 -type f -name "*.tsx" ! -name "*Page.tsx" -print || true)

if [[ -n "${bad}" ]]; then
  echo "ERROR: Non-*Page.tsx files found in src/pages:"
  echo "${bad}"
  exit 1
fi

echo "OK: All page files are *Page.tsx"
