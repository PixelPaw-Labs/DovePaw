#!/usr/bin/env bash
#
# screenshot.sh — Capture DovePaw embedded browser screenshot and save to file
#
# Calls the DovePaw browser bridge to take a screenshot, decodes the base64
# response and writes it to disk. Returns the file path instead of raw
# base64, keeping AI agent context clean.
#
# Usage:
#   screenshot.sh                        # save PNG to /tmp/dovepaw-browser-screenshots/
#   screenshot.sh -o ~/Desktop/shot.png  # save to custom path
#   screenshot.sh -f jpeg -q 60          # JPEG at quality 60
#
# Dependencies: curl, jq, python3, base64 (pre-installed on macOS/Linux)

set -euo pipefail

OUTPUT_DIR="/tmp/dovepaw-browser-screenshots"
OUTPUT_PATH=""
FORMAT="png"
QUALITY=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  -o PATH      Output file path (default: /tmp/dovepaw-browser-screenshots/{timestamp}.{format})
  -f FORMAT    Image format: png (default) or jpeg
  -q QUALITY   JPEG quality 0-100 (only for jpeg format)
  -h           Show this help
EOF
  exit 0
}

while getopts "o:f:q:h" opt; do
  case "$opt" in
    o) OUTPUT_PATH="$OPTARG" ;;
    f) FORMAT="$OPTARG" ;;
    q) QUALITY="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

# Resolve bridge port from DovePaw port file
PORT_FILE="$HOME/.dovepaw/.browser-bridge-port.json"
if [[ ! -f "$PORT_FILE" ]]; then
  echo "Error: DovePaw browser bridge port file not found at $PORT_FILE" >&2
  echo "Is the DovePaw Electron app running? See references/operations.md" >&2
  exit 1
fi

BRIDGE_PORT=$(python3 -c "import json; d=json.load(open('$PORT_FILE')); print(d['port'])")
BRIDGE_URL="http://127.0.0.1:${BRIDGE_PORT}"

# Build request body
ARGS=$(jq -n --arg fmt "$FORMAT" '{format: $fmt}')
if [[ -n "$QUALITY" ]]; then
  ARGS=$(echo "$ARGS" | jq --argjson q "$QUALITY" '. + {quality: $q}')
fi

BODY=$(jq -n --arg action "screenshot" --argjson args "$ARGS" '{action: $action, args: $args}')

# Call bridge
RESPONSE=$(curl -s -X POST "${BRIDGE_URL}/command" \
  -H 'Content-Type: application/json' \
  -d "$BODY" \
  --max-time 30)

# Check for errors
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
  ERROR=$(echo "$RESPONSE" | jq -r '.error')
  echo "Error: $ERROR" >&2
  exit 1
fi

# Extract base64 data
B64_DATA=$(echo "$RESPONSE" | jq -er '.data.data // .data // empty | select(type == "string" and length > 0)')
if [[ -z "$B64_DATA" ]]; then
  echo "Error: No image data in response" >&2
  echo "Response: $(echo "$RESPONSE" | head -c 200)" >&2
  exit 1
fi

# Determine output path
if [[ -z "$OUTPUT_PATH" ]]; then
  mkdir -p "$OUTPUT_DIR"
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  EXT="$FORMAT"
  [[ "$EXT" == "jpeg" ]] && EXT="jpg"
  OUTPUT_PATH="${OUTPUT_DIR}/${TIMESTAMP}.${EXT}"
fi

# Decode base64 — handle macOS (base64 -D) vs Linux (base64 -d)
if base64 --help 2>&1 | grep -q '\-D'; then
  echo "$B64_DATA" | base64 -D > "$OUTPUT_PATH"
else
  echo "$B64_DATA" | base64 -d > "$OUTPUT_PATH"
fi

echo "$OUTPUT_PATH"
