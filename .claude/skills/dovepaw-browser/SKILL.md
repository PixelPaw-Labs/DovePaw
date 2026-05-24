---
name: dovepaw-browser
description: |
  DovePaw Browser lets AI control the embedded Chromium browser panel inside the DovePaw Electron app — navigate, click, type, read, screenshot, and interact with any website using a dedicated persistent session. Use whenever the user wants to browse websites, automate web tasks, scrape content, or perform any browser action. Also use when the user mentions "browser", "webpage", "open URL", "screenshot", or asks to read/interact with any website inside DovePaw.
argument-hint: "[session-name]"
---

# DovePaw Browser

Control the embedded browser panel in the DovePaw Electron app via a local bridge server.

## Inputs

- SESSION: $ARGUMENTS[0] — if empty, derive: `SESSION=$(basename "${AGENT_WORKSPACE:-default}")`

Each session is a separate browser tab. Two concurrent agents each get their own tab when they use distinct session names.

## Setup (do once at the start of each task)

Resolve the bridge port and set SESSION:

```bash
PORT=$(python3 -c "import json; d=json.load(open('$HOME/.dovepaw/.browser-bridge-port.json')); print(d['port'])")
BRIDGE="http://127.0.0.1:${PORT}"
SESSION=<value from Inputs; bash equivalent: SESSION=$(basename "${AGENT_WORKSPACE:-default}")>
```

Then check the bridge is healthy:

```bash
curl -s "${BRIDGE}/status"
```

- **`{"running":true,...}`** — proceed.
- **Anything else** — read `references/operations.md` for diagnosis.

All examples below use `BRIDGE` and `SESSION`.

## Tools

| Tool            | Args                                  | Returns                                    | Note                                                                      |
| --------------- | ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `navigate`      | `url`                                 | `{ok, url}`                                | Navigates to URL; also shows the browser panel if hidden                  |
| `snapshot`      | —                                     | `{ok, data: accessibility_tree}`           | Raw CDP accessibility tree — use to read page content and locate elements |
| `click`         | `selector` (CSS)                      | `{ok, tag, text}`                          | Clicks element matching CSS selector                                      |
| `fill`          | `selector` (CSS), `value`             | `{ok, tag}`                                | Sets input/textarea value and fires input/change events                   |
| `evaluate`      | `code` (supports async/await)         | `{ok, result}`                             | Evaluates JS in page context                                              |
| `screenshot`    | `format`(png\|jpeg), `quality`(0-100) | `{ok, format, dataLength, data}` (base64)  | Full page — use helper script to save to disk                             |
| `list_tabs`     | —                                     | `{ok, tabs:[{tabId, url, title, active}]}` | Returns all open sessions/tabs                                            |
| `close_session` | —                                     | `{ok, session}`                            | Signal done with this session                                             |

### Call format

Always include the session so your tab is isolated from other concurrent agents:

```bash
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"https://example.com"},"session":"'"${SESSION}"'"}'
```

## Working with selectors

This bridge uses **CSS selectors** for `click` and `fill`. Use `snapshot` to get the accessibility tree, then use `evaluate` to inspect the DOM and find the right selector.

Workflow:

1. Call `snapshot` to see the page structure
2. Use `evaluate` to find a stable selector: `document.querySelector('button[type=submit]')?.getAttribute('data-testid')`
3. Call `click` or `fill` with the CSS selector

```bash
# Read the page structure
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"snapshot","session":"'"${SESSION}"'"}'

# Find a selector
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"evaluate","args":{"code":"document.querySelectorAll(\"input\").length"},"session":"'"${SESSION}"'"}'

# Click a button
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"click","args":{"selector":"button[type=submit]"},"session":"'"${SESSION}"'"}'

# Fill an input
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"fill","args":{"selector":"input[name=email]","value":"user@example.com"},"session":"'"${SESSION}"'"}'
```

## Screenshots: use the helper script

**Never call the screenshot API directly** — it returns base64-encoded image data that floods the context window.

Use `scripts/screenshot.sh` instead:

```bash
# Default — saves PNG to /tmp/dovepaw-browser-screenshots/{timestamp}.png
bash "$(dirname "$SKILL_PATH")/scripts/screenshot.sh"

# Custom output path
bash "$(dirname "$SKILL_PATH")/scripts/screenshot.sh" -o /tmp/page.png

# JPEG format, quality 60
bash "$(dirname "$SKILL_PATH")/scripts/screenshot.sh" -f jpeg -q 60
```

After getting the file path, use the Read tool to view the image.

## Evaluate tips

- Always use compact `JSON.stringify(data)` — never add `null, 2` formatting. Indentation inflates response size and causes truncation.
- Re-declaring `const`/`let` across two `evaluate` calls throws `SyntaxError`. Wrap in an IIFE: `(() => { const x = ...; return x; })()`

## Form submit / special keys

Click the submit button directly. To dispatch a key event:

```bash
curl -s -X POST "${BRIDGE}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"evaluate","args":{"code":"document.activeElement.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Enter\",bubbles:true}))"},"session":"'"${SESSION}"'"}'
```

## Toggle browser panel visibility

```bash
curl -s -X POST "${BRIDGE}/browser/toggle"
```

## Known limitations

- **CSS selectors only** — `click` and `fill` require valid CSS selectors. `@e` ref support is not yet implemented.
- **Sites checking `event.isTrusted`** — synthetic click/fill events have `isTrusted=false`. Banking portals and captchas may reject them.
- **Cross-origin iframes** — `evaluate`, `snapshot`, `click`, and `fill` operate on the top frame only.
