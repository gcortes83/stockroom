#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pattern='^\s*(//|/\*|\*\s|\*/)'
if [ "$#" -gt 0 ]; then
  files=()
  for file in "$@"; do
    case "$file" in
      *node_modules/*|*/dist/*) ;;
      *.ts|*.tsx|*.mjs) [ -f "$file" ] && files+=("$file") ;;
    esac
  done
  [ "${#files[@]}" -eq 0 ] && { echo "No source files to check."; exit 0; }
  matches=$(grep -nEH "$pattern" "${files[@]}" | grep -v '/// <reference' || true)
else
  matches=$(grep -rnE "$pattern" --include='*.ts' --include='*.tsx' --include='*.mjs' apps services packages scripts \
    --exclude-dir=node_modules --exclude-dir=dist | grep -v '/// <reference' || true)
fi
if [ -n "$matches" ]; then
  echo "Comments found in source files (challenge rule: no code comments):"
  echo "$matches"
  exit 1
fi
echo "No comments found in source files."
