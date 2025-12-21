#!/usr/bin/env bash
set -euo pipefail

# find any route declarations outside App.tsx
hits=$(rg -n "<Route|createBrowserRouter|RouterProvider|useRoutes" src \
  --glob '!src/App.tsx' || true)

if [[ -n "${hits}" ]]; then
  echo "ERROR: Route declarations found outside src/App.tsx:"
  echo "${hits}"
  exit 1
fi

echo "OK: Routes only declared in src/App.tsx"
