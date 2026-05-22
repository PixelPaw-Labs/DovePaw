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

      const docResult = await cdp("DOM.getDocument", { depth: 0 });
      const { nodeId: rootId } = docResult as { nodeId: number };
      const qResult = await cdp("DOM.querySelector", { nodeId: rootId, selector });
      const { nodeId } = qResult as { nodeId: number };
      if (!nodeId) throw new Error(`No element found for selector: ${selector}`);

      const boxResult = await cdp("DOM.getBoxModel", { nodeId });
      const { model } = boxResult as { model: { content: number[] } };
      const [x1, y1, , , x3, y3] = model.content;
      const cx = (x1 + x3) / 2;
      const cy = (y1 + y3) / 2;

      /* oxlint-disable eslint/no-await-in-loop -- mouse events must fire sequentially: move → press → release */
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"] as const) {
        await cdp("Input.dispatchMouseEvent", {
          type,
          x: cx,
          y: cy,
          button: "left",
          clickCount: type === "mousePressed" || type === "mouseReleased" ? 1 : 0,
        });
      }
      /* oxlint-enable eslint/no-await-in-loop */

      const tagResult = await cdp("Runtime.evaluate", {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? JSON.stringify({tag: el.tagName, text: el.innerText?.slice(0,80)}) : null })()`,
        returnByValue: true,
      });
      const tagRaw: unknown = (tagResult as { result: { value: unknown } }).result.value;
      const info: { tag?: string; text?: string } =
        typeof tagRaw === "string" ? (JSON.parse(tagRaw) as { tag?: string; text?: string }) : {};
      return { ok: true, ...info };
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
