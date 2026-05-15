# DovePaw Browser — Operations & Troubleshooting

## Health check routing table

Run the health check from SKILL.md first, then match your result below.

### Port file missing (`~/.dovepaw/.browser-bridge-port.json` not found)

The DovePaw Electron app is not running, or it started but the bridge server hasn't written its port yet.

```bash
# Check if DovePaw is running
pgrep -fl "DovePaw\|electron.*dovepaw" | head -5
```

- If no output: open DovePaw (`npm run electron:dev` in the repo, or launch the app).
- If running: wait a few seconds and retry — the bridge server starts asynchronously after the app window opens.

### Connection refused (`curl: (7) Failed to connect`)

The port file exists but nothing is listening on that port. The bridge server crashed or the app restarted on a new port.

```bash
# Check the current port
cat ~/.dovepaw/.browser-bridge-port.json

# Try connecting
PORT=$(python3 -c "import json; d=json.load(open('$HOME/.dovepaw/.browser-bridge-port.json')); print(d['port'])")
curl -s "http://127.0.0.1:${PORT}/status"
```

Fix: restart DovePaw. The bridge writes a fresh port file on each start.

### `/status` returns `{"running":false}` or an error JSON

The bridge is reachable but reports an internal error (e.g., CDP debugger not attached).

Fix: close and reopen the browser panel in DovePaw UI (click the browser toggle button), then retry. Reopening re-creates the WebContentsView and reattaches the CDP debugger.

### `/status` returns non-JSON (HTML error page, proxy response)

Something else is listening on that port. This shouldn't happen with OS-assigned ports, but if it does:

```bash
# Find what's on the port
lsof -i :$PORT
```

Restart DovePaw to get a fresh port assignment.

## Checking DovePaw logs

```bash
tail -f ~/.dovepaw/logs/electron.log
```

Bridge server start/stop events are logged there.

## Verifying the bridge is active

```bash
PORT=$(python3 -c "import json; d=json.load(open('$HOME/.dovepaw/.browser-bridge-port.json')); print(d['port'])")
curl -s "http://127.0.0.1:${PORT}/status" | python3 -m json.tool
```

Expected healthy response:

```json
{
  "running": true,
  "bridge": "dovepaw"
}
```

## Testing navigation

```bash
PORT=$(python3 -c "import json; d=json.load(open('$HOME/.dovepaw/.browser-bridge-port.json')); print(d['port'])")
curl -s -X POST "http://127.0.0.1:${PORT}/command" \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"https://example.com"}}' | python3 -m json.tool
```

If this fails but `/status` is healthy, there may be a CDP issue. Try toggling the browser panel off and on in the DovePaw UI.
