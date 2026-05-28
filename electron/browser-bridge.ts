import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { writeFile } from "node:fs/promises";
import { BROWSER_BRIDGE_PORT_FILE } from "../lib/paths";

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface TabInfo {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  const hasBody = req.headers["content-length"] != null || req.headers["transfer-encoding"] != null;
  if (!hasBody) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v : "";
}

export function parseFilesArg(args: Record<string, unknown>): string[] {
  const raw = args.files;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((f) => typeof f === "string")) {
    throw new Error("args.files must be a non-empty array of absolute paths");
  }
  return raw;
}

/* oxlint-disable typescript-eslint/no-unsafe-type-assertion -- CDP sendCommand returns unknown; no type definitions available without a full CDP type library */
async function handleCommand(
  body: string,
  getTabCdp: (sessionId: string) => CdpSend,
  listTabs: () => TabInfo[],
  onShow: (sessionId: string) => void,
  onClose: (sessionId: string) => void,
): Promise<unknown> {
  const raw: unknown = JSON.parse(body);
  if (!raw || typeof raw !== "object" || !("action" in raw)) {
    throw new Error("Invalid JSON body");
  }
  const parsed = raw as { action: string; args?: Record<string, unknown>; session?: string };
  const { action, args = {}, session = "default" } = parsed;
  const cdp = getTabCdp(session);

  switch (action) {
    case "navigate": {
      const url = stringArg(args, "url");
      if (!url) throw new Error("args.url is required");
      onShow(session);
      await cdp("Page.navigate", { url });
      return { ok: true, url, session };
    }

    case "snapshot": {
      const tree = await cdp("Accessibility.getFullAXTree", {});
      return { ok: true, data: tree };
    }

    case "click": {
      const selector = stringArg(args, "selector");
      if (!selector) throw new Error("args.selector is required");

      // Look up coordinates via JS (cheaper + more robust than the DOM.getDocument
      // → querySelector → getBoxModel chain, which throws CDP "Invalid parameters"
      // when the DOM domain isn't enabled or nodeIds get invalidated by SPA re-renders).
      // Also scrolls the element into view first so the click hits the right pixel.
      const coordResult = await cdp("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return JSON.stringify({error: "not-found"});
          el.scrollIntoView({block: "center", inline: "center"});
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return JSON.stringify({error: "zero-size", rect: [r.left, r.top, r.width, r.height]});
          return JSON.stringify({
            x: r.left + r.width / 2,
            y: r.top + r.height / 2,
            tag: el.tagName,
            text: (el.innerText || "").slice(0, 80),
          });
        })()`,
        returnByValue: true,
      });
      const coordValue: unknown = (coordResult as { result: { value: unknown } }).result.value;
      const info: {
        error?: string;
        rect?: number[];
        x?: number;
        y?: number;
        tag?: string;
        text?: string;
      } =
        typeof coordValue === "string"
          ? (JSON.parse(coordValue) as {
              error?: string;
              rect?: number[];
              x?: number;
              y?: number;
              tag?: string;
              text?: string;
            })
          : {};
      if (info.error) {
        throw new Error(`click ${selector}: ${info.error} ${JSON.stringify(info.rect ?? "")}`);
      }

      /* oxlint-disable eslint/no-await-in-loop -- mouse events must fire sequentially: move → press → release */
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
        await cdp("Input.dispatchMouseEvent", {
          type,
          x: info.x,
          y: info.y,
          button: "left",
          clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
        });
      }
      /* oxlint-enable eslint/no-await-in-loop */

      return { ok: true, tag: info.tag, text: info.text };
    }

    case "set_input_files": {
      // Upload files to an <input type="file"> via CDP DOM.setFileInputFiles.
      // This is how Playwright/Puppeteer do it — fires the native change event
      // from inside the renderer's input layer so React/Vue accept it.
      // Uses objectId from Runtime.evaluate (more reliable than nodeId across SPA re-renders).
      const selector = stringArg(args, "selector");
      if (!selector) throw new Error("args.selector is required");
      const files = parseFilesArg(args);

      const evalResult = await cdp("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
        returnByValue: false,
      });
      const { result } = evalResult as { result: { subtype?: string; objectId?: string } };
      if (!result || result.subtype === "null" || !result.objectId) {
        throw new Error(`No element found for selector: ${selector}`);
      }
      try {
        await cdp("DOM.setFileInputFiles", { files, objectId: result.objectId });
        return { ok: true, count: files.length };
      } finally {
        await cdp("Runtime.releaseObject", { objectId: result.objectId }).catch(() => {});
      }
    }

    case "fill": {
      const selector = stringArg(args, "selector");
      const value = stringArg(args, "value");
      if (!selector) throw new Error("args.selector is required");

      await cdp("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSet) { nativeSet.call(el, ${JSON.stringify(value)}); }
          else { el.value = ${JSON.stringify(value)}; }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()`,
        awaitPromise: false,
      });

      const tagResult = await cdp("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? el.tagName : null })()`,
        returnByValue: true,
      });
      const tag: unknown = (tagResult as { result: { value: unknown } }).result.value;
      return { ok: true, tag: typeof tag === "string" ? tag : "UNKNOWN" };
    }

    case "evaluate": {
      const code = stringArg(args, "code");
      if (!code) throw new Error("args.code is required");
      const evalResult = await cdp("Runtime.evaluate", {
        expression: code,
        awaitPromise: true,
        returnByValue: true,
      });
      const { result } = evalResult as { result: { value: unknown; type: string } };
      return { ok: true, type: result.type, value: result.value };
    }

    case "screenshot": {
      const format = stringArg(args, "format") || "png";
      const quality = typeof args.quality === "number" ? args.quality : undefined;
      const params: Record<string, unknown> = { format };
      if (quality !== undefined) params.quality = quality;
      const shotResult = await cdp("Page.captureScreenshot", params);
      const { data } = shotResult as { data: string };
      return { ok: true, format, dataLength: data.length, data };
    }

    case "list_tabs":
      return { ok: true, tabs: listTabs() };

    case "close_session": {
      onClose(session);
      return { ok: true, session };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
/* oxlint-enable typescript-eslint/no-unsafe-type-assertion */

export interface BrowserBridge {
  port: number;
  server: Server;
  close(): Promise<void>;
}

export async function startBrowserBridge(
  getTabCdp: (sessionId: string) => CdpSend,
  listTabs: () => TabInfo[],
  onShow: (sessionId: string) => void,
  onToggle: () => void,
  onClose: (sessionId: string) => void,
): Promise<BrowserBridge> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      try {
        if (method === "GET" && url === "/status") {
          return json(res, 200, { running: true, bridge: "dovepaw" });
        }

        if (method === "POST" && url === "/browser/toggle") {
          onToggle();
          return json(res, 200, { ok: true });
        }

        if (method === "POST" && url === "/browser/show") {
          onShow("default");
          return json(res, 200, { ok: true });
        }

        if (method === "POST" && url === "/browser/hide") {
          onToggle();
          return json(res, 200, { ok: true });
        }

        if (method === "POST" && url === "/command") {
          const body = await readBody(req);
          const result = await handleCommand(body, getTabCdp, listTabs, onShow, onClose);
          return json(res, 200, result);
        }

        json(res, 404, { error: "Not found" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        json(res, 500, { error: message });
      }
    })();
  });

  // Disable all server-side timeouts so long-running commands (image downloads,
  // multi-minute evaluate calls) are never cut short by Node's defaults.
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.timeout = 0;

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const rawAddr = server.address();
  if (!rawAddr || typeof rawAddr === "string") throw new Error("Server failed to bind to a port");
  const port = rawAddr.port;

  await writeFile(BROWSER_BRIDGE_PORT_FILE, JSON.stringify({ port }, null, 2) + "\n");

  return {
    port,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
