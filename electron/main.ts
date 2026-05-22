import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  WebContentsView,
} from "electron";
import { type ChildProcess, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createServersProcess } from "../lib/server-manager";
import { linkAgents } from "../lib/installer";
import {
  BROWSER_BRIDGE_PORT_FILE,
  DOVEPAW_DIR,
  DOVEPAW_LOGS_DIR,
  OPENVIKING_PORT_FILE,
  OPENVIKING_SIDECAR_PID_FILE,
  portsFile,
} from "../lib/paths";
import { bootOpenViking } from "../lib/openviking-spawner";
import { getAvailablePort } from "../lib/get-available-port";
import { killStaleProcess, writePidFile } from "../lib/process-orphan-cleanup";
import { startBrowserBridge } from "./browser-bridge";
import { animate } from "animejs";

// Prevent Google/sites from detecting Electron's Chromium as a bot
app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

// Scope all Electron session data under ~/.dovepaw/browser/ to keep ~/.dovepaw/ clean
// Must be set before app.whenReady() — affects session.fromPartition() partition paths
app.setPath("userData", join(DOVEPAW_DIR, "browser"));

// electron/.dist/main.cjs → ../../ = DovePaw repo root
const REPO_ROOT = resolve(__dirname, "../..");
const NEXT_PORT = 7473;
const PORTS_FILE = portsFile(NEXT_PORT);
const ASSETS_DIR = resolve(__dirname, "../assets");
const LOGS_DIR = DOVEPAW_LOGS_DIR;
const NPM_BIN = "npm";
const CHATBOT_URL = `http://localhost:${NEXT_PORT}`;
const SERVICE_NAME = "DovePaw";
const WINDOW_STATE_FILE = join(DOVEPAW_DIR, "window-state.json");

const SIDECAR_CMDLINE_RE = /openviking-server/;

let browserXFraction = 0.6; // fraction of content width where browser panel starts

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let serversProcess: ChildProcess | null = null;
let nextProcess: ChildProcess | null = null;
let ovProcess: ChildProcess | null = null;
let isQuitting = false;
let browserPanelVisible = false;
let browserCompact = false;

// ── Logging ───────────────────────────────────────────────────────────────────

function pipeToLog(proc: ChildProcess, name: string): void {
  mkdirSync(LOGS_DIR, { recursive: true });
  const stream = createWriteStream(resolve(LOGS_DIR, `${name}.log`), { flags: "w" });
  proc.stdout?.pipe(stream);
  proc.stderr?.pipe(stream);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function makeIcon(active: boolean): Electron.NativeImage {
  const file = active ? "icon.png" : "iconError.png";
  const path = resolve(ASSETS_DIR, file);
  if (!existsSync(path)) return nativeImage.createEmpty();
  const img = nativeImage.createFromPath(path);
  img.setTemplateImage(false);
  return img;
}

// ── Health ────────────────────────────────────────────────────────────────────

let healthy = false;

function checkHealth(): void {
  if (!existsSync(PORTS_FILE)) {
    healthy = false;
    refreshTray();
    return;
  }
  try {
    const raw: unknown = JSON.parse(readFileSync(PORTS_FILE, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      healthy = false;
      refreshTray();
      return;
    }
    const manifest: Record<string, unknown> = Object.fromEntries(Object.entries(raw));
    const port = Object.values(manifest).find((v): v is number => typeof v === "number")!;
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1_000);
    socket.on("connect", () => {
      socket.destroy();
      healthy = true;
      refreshTray();
    });
    socket.on("error", () => {
      healthy = false;
      refreshTray();
    });
    socket.on("timeout", () => {
      socket.destroy();
      healthy = false;
      refreshTray();
    });
  } catch {
    healthy = false;
    refreshTray();
  }
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function refreshTray(): void {
  if (!tray) return;
  const icon = makeIcon(healthy);
  if (icon.isEmpty()) {
    tray.setTitle(healthy ? "▲" : "▽");
  } else {
    tray.setImage(icon);
    tray.setTitle("");
  }
  tray.setToolTip(healthy ? `${SERVICE_NAME} — servers running` : `${SERVICE_NAME} — servers down`);
  tray.setContextMenu(buildMenu(healthy));
}

function buildMenu(isHealthy: boolean): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: SERVICE_NAME,
      icon: nativeImage.createFromPath(
        resolve(ASSETS_DIR, isHealthy ? "dot-green.png" : "dot-red.png"),
      ),
      click: () => {},
    },
    { type: "separator" },
    {
      label: "Open Dove",
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      },
    },
    {
      label: "Restart Servers",
      click: restartServers,
    },
    { type: "separator" },
    {
      label: "Open Logs",
      click: () => shell.openPath(LOGS_DIR),
    },
    {
      label: "Start at Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) =>
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          serviceName: SERVICE_NAME,
          name: SERVICE_NAME,
        }),
    },
    { type: "separator" },
    {
      label: "Quit Dove",
      accelerator: "Command+Q",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

// ── Window state ──────────────────────────────────────────────────────────────

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

function loadWindowState(): WindowState {
  try {
    if (existsSync(WINDOW_STATE_FILE)) {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- unknown → WindowState: shape validated by try/catch around corrupt files
      return JSON.parse(readFileSync(WINDOW_STATE_FILE, "utf-8")) as WindowState;
    }
  } catch {
    // ignore corrupt state
  }
  return { width: 1400, height: 800 };
}

function saveWindowState(w: BrowserWindow): void {
  try {
    const bounds = w.getBounds();
    writeFileSync(WINDOW_STATE_FILE, JSON.stringify(bounds, null, 2) + "\n");
  } catch {
    // best effort
  }
}

// ── Browser panel bounds ──────────────────────────────────────────────────────

const BROWSER_HEADER_HEIGHT = 44; // matches chatbot header height

/** Compute the screen bounds for the browser overlay window. xFraction sets where it starts. */
function browserWinBounds(w: BrowserWindow): Electron.Rectangle {
  const outer = w.getBounds();
  const [contentW, contentH] = w.getContentSize();
  const titleBarH = outer.height - contentH;
  const xOffset = Math.floor(contentW * browserXFraction);
  return {
    x: outer.x + xOffset,
    y: outer.y + titleBarH + BROWSER_HEADER_HEIGHT,
    width: contentW - xOffset,
    height: contentH - BROWSER_HEADER_HEIGHT,
  };
}

/** Compact (mini) bounds: small floating window pinned to the bottom-right of the content area. */
function browserMiniWinBounds(w: BrowserWindow): Electron.Rectangle {
  const outer = w.getBounds();
  const [contentW, contentH] = w.getContentSize();
  const titleBarH = outer.height - contentH;
  return {
    x: outer.x + contentW - 300 - 12,
    y: outer.y + titleBarH + contentH - 240 - 12,
    width: 300,
    height: 240,
  };
}

// ── Servers ───────────────────────────────────────────────────────────────────

function startServers(): void {
  if (serversProcess) return;

  serversProcess = createServersProcess(NEXT_PORT, "pipe");
  pipeToLog(serversProcess, "a2a-servers");

  serversProcess.on("exit", () => {
    serversProcess = null;
    if (!isQuitting) setTimeout(startServers, 5_000);
  });

  // Check immediately, then rely on the 5s poll interval
  checkHealth();
}

function restartServers(): void {
  serversProcess?.kill("SIGTERM");
  serversProcess = null;
  refreshTray();
  setTimeout(startServers, 500);
}

async function startOpenViking(): Promise<void> {
  // Reuse an already-running sidecar (e.g. started by npm run chatbot:dev boot script).
  try {
    const parsed: unknown = JSON.parse(readFileSync(OPENVIKING_PORT_FILE, "utf-8"));
    const maybePort =
      parsed !== null && typeof parsed === "object" && "port" in parsed
        ? (parsed as Record<string, unknown>).port
        : undefined;
    const port = typeof maybePort === "number" ? maybePort : null;
    if (port) {
      await fetch(`http://localhost:${port}/health`);
      console.log(`✓ OpenViking sidecar already running at http://localhost:${port}`);
      return;
    }
  } catch {
    // Port file missing, invalid, or sidecar not responding — boot fresh below.
  }

  await killStaleProcess(OPENVIKING_SIDECAR_PID_FILE, SIDECAR_CMDLINE_RE);
  const port = await getAvailablePort();
  try {
    ovProcess = await bootOpenViking(port);
    if (ovProcess.pid !== undefined) writePidFile(OPENVIKING_SIDECAR_PID_FILE, ovProcess.pid);
    await mkdir(dirname(OPENVIKING_PORT_FILE), { recursive: true });
    await writeFile(OPENVIKING_PORT_FILE, JSON.stringify({ port }, null, 2));
    console.log(`✓ OpenViking sidecar ready at http://localhost:${port}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await rm(OPENVIKING_PORT_FILE, { force: true }).catch(() => {});
    console.warn(`⚠ OpenViking boot failed: ${msg} — group chat will fall back to .md moments`);
  }
}

function startNextJs(): void {
  if (nextProcess) return;

  nextProcess = spawn(NPM_BIN, ["run", "chatbot:dev"], {
    cwd: REPO_ROOT,
    env: { ...process.env, DOVEPAW_PORT: String(NEXT_PORT) },
    stdio: "pipe",
    detached: true,
  });

  pipeToLog(nextProcess, "nextjs");

  nextProcess.on("exit", () => {
    nextProcess = null;
    if (!isQuitting) setTimeout(startNextJs, 5_000);
  });
}

// ── App ───────────────────────────────────────────────────────────────────────

app.setName(SERVICE_NAME);
process.title = SERVICE_NAME;

void app.whenReady().then(async () => {
  await linkAgents();

  // Set dock icon on macOS (dev mode doesn't pick up the bundled icns automatically)
  if (process.platform === "darwin" && app.dock) {
    const dockIconPath = resolve(ASSETS_DIR, "icon.png");
    if (existsSync(dockIconPath)) app.dock.setIcon(nativeImage.createFromPath(dockIconPath));
  }

  // ── Main window ──
  const windowState = loadWindowState();
  win = new BrowserWindow({
    ...windowState,
    minWidth: 1200,
    minHeight: 700,
    title: SERVICE_NAME,
    icon: resolve(ASSETS_DIR, "icon.png"),
    webPreferences: {
      preload: resolve(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide to tray on close instead of quitting
  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win?.hide();
    }
  });

  // Persist window bounds on resize/move
  win.on("resize", () => win && saveWindowState(win));
  win.on("move", () => win && saveWindowState(win));

  // ── Embedded browser panel ──
  // A separate frameless BrowserWindow gives us setOpacity() + setIgnoreMouseEvents(),
  // which are the only OS-level way to produce a true semi-transparent overlay.
  const browserSession = session.fromPartition("persist:browser-profile", { cache: true });
  browserSession.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  );
  browserSession.setSpellCheckerLanguages(["en-US"]);
  app.commandLine.appendSwitch("lang", "en-US");
  app.commandLine.appendSwitch("accept-lang", "en-US,en;q=0.9");
  // Convert session cookies (no expiry) to persistent ones so Okta/SSO logins survive restarts.
  // Chromium only restores persistent cookies on startup — session cookies are always discarded.
  const THIRTY_DAYS_S = 30 * 24 * 60 * 60;
  browserSession.cookies.on("changed", (_e, cookie, _cause, removed) => {
    if (removed || cookie.expirationDate) return; // already persistent or being deleted
    const url = `${cookie.secure ? "https" : "http"}://${(cookie.domain ?? "").replace(/^\./, "")}${cookie.path ?? "/"}`;
    void browserSession.cookies
      .set({
        url,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: Math.floor(Date.now() / 1000) + THIRTY_DAYS_S,
        sameSite: cookie.sameSite ?? "unspecified",
      })
      .then(() => console.log(`[cookies] persisted ${cookie.name} on ${cookie.domain}`))
      .catch((err: unknown) =>
        console.warn(`[cookies] failed to persist ${cookie.name} on ${cookie.domain}:`, err),
      );
  });

  const TOOLBAR_HEIGHT = 70; // 30px tabs row + 40px nav row

  // ── Embedded browser window — pure container, toolbar is a pinned WebContentsView ──
  const browserWin = new BrowserWindow({
    parent: win,
    frame: false,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Toolbar WebContentsView — always pinned at top, always above tab views
  const toolbarView = new WebContentsView({
    webPreferences: {
      preload: resolve(__dirname, "browser-toolbar-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void toolbarView.webContents.loadFile(resolve(ASSETS_DIR, "browser-toolbar.html"));
  browserWin.contentView.addChildView(toolbarView);
  toolbarView.webContents.on("did-finish-load", () => {
    // Resize toolbar to full width at y=0 and push initial state
    const [w] = browserWin.getContentSize();
    toolbarView.setBounds({ x: 0, y: 0, width: w, height: TOOLBAR_HEIGHT });
    notifyToolbarState();
  });
  console.log("[browser] session isPersistent:", browserSession.isPersistent());

  // Keep browser window aligned with the right half of the main window
  const syncBrowserWinBounds = () => {
    if (browserPanelVisible && win)
      browserWin.setBounds(browserCompact ? browserMiniWinBounds(win) : browserWinBounds(win));
  };
  win.on("resize", syncBrowserWinBounds);
  win.on("move", syncBrowserWinBounds);

  let activeBoundsAnim: ReturnType<typeof animate> | null = null;
  function animateBrowserWinBounds(to: Electron.Rectangle, duration: number, ease: string): void {
    activeBoundsAnim?.pause();
    const from = browserWin.getBounds();
    const b = { x: from.x, y: from.y, width: from.width, height: from.height };
    activeBoundsAnim = animate(b, {
      x: to.x,
      y: to.y,
      width: to.width,
      height: to.height,
      duration,
      ease,
      onUpdate: () => {
        if (!browserWin.isDestroyed()) {
          browserWin.setBounds({
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.round(b.width),
            height: Math.round(b.height),
          });
        }
      },
    });
  }

  // ── Tab management ──
  interface BrowserTab {
    sessionId: string;
    view: WebContentsView;
    cdp: import("./browser-bridge").CdpSend;
  }
  const tabs = new Map<string, BrowserTab>();
  let activeSessionId = "default";

  const notifyVisibility = (v: boolean) => {
    try {
      win?.webContents.send("browser:visibility-changed", v);
    } catch {
      // renderer not ready yet — ignore
    }
  };

  const notifyTabsChanged = () => {
    try {
      win?.webContents.send("browser:tabs-changed", listTabs());
    } catch {
      // renderer not ready yet — ignore
    }
  };

  function getOrCreateTab(sessionId: string): BrowserTab {
    const isNew = !tabs.has(sessionId);
    if (!isNew) return tabs.get(sessionId)!;
    const view = new WebContentsView({
      webPreferences: { session: browserSession, contextIsolation: true, nodeIntegration: false },
    });
    view.webContents.on("dom-ready", () => {
      void view.webContents.executeJavaScript(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})",
      );
    });
    view.webContents.on("did-navigate", () => notifyToolbarState());
    view.webContents.on("did-navigate-in-page", () => notifyToolbarState());
    view.webContents.on("page-title-updated", () => notifyToolbarState());
    try {
      view.webContents.debugger.attach("1.3");
    } catch {
      // already attached
    }
    const cdp: import("./browser-bridge").CdpSend = async (method, params = {}) => {
      const result: unknown = await view.webContents.debugger.sendCommand(method, params);
      return result;
    };
    const tab: BrowserTab = { sessionId, view, cdp };
    tabs.set(sessionId, tab);
    void view.webContents.loadURL("about:blank"); // initialize the view
    notifyTabsChanged();
    return tab;
  }

  const notifyToolbarState = () => {
    const tab = tabs.get(activeSessionId);
    const wc = tab?.view.webContents;
    const tabCount = tabs.size;
    console.log(`[toolbar:state] tabs=${tabCount} active=${activeSessionId.slice(0, 8)}`);
    try {
      toolbarView.webContents.send("toolbar:state", {
        url: wc?.getURL() ?? "",
        title: wc?.getTitle() ?? "",
        canGoBack: wc?.navigationHistory?.canGoBack() ?? false,
        canGoForward: wc?.navigationHistory?.canGoForward() ?? false,
        tabs: Array.from(tabs.values()).map((t) => {
          const tabUrl = t.view.webContents.getURL();
          const tabTitle = t.view.webContents.getTitle();
          let label = tabTitle;
          if (!label && tabUrl && tabUrl !== "about:blank") {
            try {
              label = new URL(tabUrl).hostname;
            } catch {
              /* ignore */
            }
          }
          return {
            tabId: t.sessionId.slice(0, 8),
            fullId: t.sessionId,
            label: label || t.sessionId.slice(0, 8),
            active: t.sessionId === activeSessionId,
          };
        }),
      });
    } catch {
      // toolbar not ready
    }
  };

  function closeTab(sessionId: string): void {
    const tab = tabs.get(sessionId);
    if (!tab) return;
    try {
      tab.view.webContents.debugger.detach();
    } catch {
      /* already detached */
    }
    try {
      browserWin.contentView.removeChildView(tab.view);
    } catch {
      /* not attached */
    }
    tabs.delete(sessionId);
    if (activeSessionId === sessionId) {
      const remaining = Array.from(tabs.keys());
      if (remaining.length > 0) {
        switchToTab(remaining[remaining.length - 1]);
      } else {
        browserPanelVisible = false;
        browserWin.hide();
        notifyVisibility(false);
      }
    } else {
      notifyToolbarState();
    }
  }

  function switchToTab(sessionId: string): void {
    const tab = getOrCreateTab(sessionId);
    const [w, h] = browserWin.getContentSize();
    for (const [id, t] of tabs) {
      if (id === sessionId) {
        const tabBounds = { x: 0, y: TOOLBAR_HEIGHT, width: w, height: h - TOOLBAR_HEIGHT };
        console.log(`[tab] setBounds sessionId=${id.slice(0, 8)} bounds=`, tabBounds);
        t.view.setBounds(tabBounds);
        browserWin.contentView.addChildView(t.view);
      } else {
        try {
          browserWin.contentView.removeChildView(t.view);
        } catch {
          // not added yet
        }
      }
    }
    activeSessionId = sessionId;
    void tab; // used above
    // Re-add toolbar last so it's always the topmost view, and resize it correctly
    const [tw, th] = browserWin.getContentSize();
    console.log(`[toolbar] setBounds width=${tw} height=${th} TOOLBAR_HEIGHT=${TOOLBAR_HEIGHT}`);
    toolbarView.setBounds({ x: 0, y: 0, width: tw, height: TOOLBAR_HEIGHT });
    browserWin.contentView.removeChildView(toolbarView);
    browserWin.contentView.addChildView(toolbarView);
    notifyTabsChanged();
    notifyToolbarState();
  }

  // ── IPC handlers ──
  ipcMain.handle("browser:toggle", (_event, sessionId?: string) => {
    const targetSession = sessionId ?? activeSessionId;
    browserPanelVisible = !browserPanelVisible;
    browserCompact = false;
    if (browserPanelVisible && win) {
      browserWin.setBounds(browserWinBounds(win));
      browserWin.show();
      switchToTab(targetSession);
    } else {
      browserWin.hide();
    }
    notifyVisibility(browserPanelVisible);
    return { visible: browserPanelVisible };
  });

  ipcMain.handle("browser:navigate", async (_event, url: string, sessionId?: string) => {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const targetSession = sessionId ?? activeSessionId;
    if (!browserPanelVisible && win) {
      browserPanelVisible = true;
      browserWin.setBounds(browserWinBounds(win));
      browserWin.show();
      notifyVisibility(true);
    }
    switchToTab(targetSession);
    const tab = getOrCreateTab(targetSession);
    try {
      await tab.view.webContents.loadURL(normalized);
    } catch (err) {
      console.warn(
        `[browser:navigate] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { ok: true, url: normalized };
  });

  ipcMain.handle(
    "browser:get-url",
    () => tabs.get(activeSessionId)?.view.webContents.getURL() ?? "",
  );
  ipcMain.handle("browser:set-position", (_event, xFraction: number) => {
    browserXFraction = Math.max(0.3, Math.min(0.95, xFraction));
    if (browserPanelVisible && win) {
      browserWin.setBounds(browserWinBounds(win));
      switchToTab(activeSessionId);
    }
  });

  ipcMain.handle("browser:list-tabs", () => listTabs());
  ipcMain.handle("browser:switch-tab", (_event, sessionId: string) => {
    if (!browserPanelVisible && win) {
      browserPanelVisible = true;
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
      notifyVisibility(true);
    }
    switchToTab(sessionId);
    return { activeTabId: sessionId };
  });
  ipcMain.handle("browser:back", () => {
    tabs.get(activeSessionId)?.view.webContents.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    tabs.get(activeSessionId)?.view.webContents.goForward();
  });

  // ── Toolbar IPC (from browser-toolbar-preload) ──
  ipcMain.handle("toolbar:back", () => {
    tabs.get(activeSessionId)?.view.webContents.goBack();
  });
  ipcMain.handle("toolbar:forward", () => {
    tabs.get(activeSessionId)?.view.webContents.goForward();
  });
  ipcMain.handle("toolbar:navigate", async (_event, url: string) => {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const tab = tabs.get(activeSessionId);
    if (tab) {
      await tab.view.webContents.loadURL(normalized).catch(() => {});
    }
  });
  ipcMain.handle("toolbar:close", () => {
    console.log("[toolbar:close] hiding browser");
    browserPanelVisible = false;
    browserWin.hide();
    notifyVisibility(false);
    return { visible: false };
  });
  ipcMain.handle("toolbar:switch-tab", (_event, sessionId: string) => {
    switchToTab(sessionId);
  });
  ipcMain.handle("toolbar:close-tab", (_event, sessionId: string) => {
    closeTab(sessionId);
  });
  ipcMain.handle("browser:close", () => {
    browserPanelVisible = false;
    browserWin.hide();
    notifyVisibility(false);
    return { visible: false };
  });

  // Dim: shrink to mini window in bottom-right corner so the chatbot is usable but browser stays visible
  ipcMain.handle("browser:dim", () => {
    if (!browserPanelVisible || !win) return;
    browserCompact = true;
    animateBrowserWinBounds(browserMiniWinBounds(win), 200, "inOutCubic");
  });

  // Undim: restore to full-size panel
  ipcMain.handle("browser:undim", () => {
    if (!browserPanelVisible || !win) return;
    browserCompact = false;
    animateBrowserWinBounds(browserWinBounds(win), 280, "outExpo");
    browserWin.show();
    browserWin.focus();
  });

  // ── Start bridge server ──
  // onShow(sessionId): show the panel and switch to the given session's tab.
  // Always re-shows even if browserPanelVisible=true (the window may have been hidden by dim).
  const showPanel = (sessionId: string) => {
    if (win) {
      browserPanelVisible = true;
      browserCompact = false;
      browserWin.setBounds(browserWinBounds(win));
      browserWin.showInactive();
    }
    switchToTab(sessionId);
    notifyVisibility(true);
  };

  const togglePanel = () => {
    browserPanelVisible = !browserPanelVisible;
    if (browserPanelVisible && win) {
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
      switchToTab(activeSessionId);
    } else {
      browserWin.hide();
    }
    notifyVisibility(browserPanelVisible);
  };

  const getTabCdp = (sessionId: string) => getOrCreateTab(sessionId).cdp;
  const listTabs = (): import("./browser-bridge").TabInfo[] =>
    Array.from(tabs.values()).map((t) => ({
      tabId: t.sessionId,
      url: t.view.webContents.getURL(),
      title: t.view.webContents.getTitle(),
      active: t.sessionId === activeSessionId,
    }));

  // Resize toolbar and active tab view when browserWin is resized
  browserWin.on("resize", () => {
    const [w, h] = browserWin.getContentSize();
    toolbarView.setBounds({ x: 0, y: 0, width: w, height: TOOLBAR_HEIGHT });
    tabs
      .get(activeSessionId)
      ?.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: h - TOOLBAR_HEIGHT });
  });

  // Auto-shrink to mini when user switches focus to the chatbot (single-click to dim)
  browserWin.on("blur", () => {
    if (!browserPanelVisible || browserCompact || !win) return;
    browserCompact = true;
    animateBrowserWinBounds(browserMiniWinBounds(win), 200, "inOutCubic");
  });

  // Auto-expand to full when user clicks the mini browser (single-click to restore)
  browserWin.on("focus", () => {
    if (!browserPanelVisible || !browserCompact || !win) return;
    browserCompact = false;
    animateBrowserWinBounds(browserWinBounds(win), 280, "outExpo");
    switchToTab(activeSessionId);
  });

  try {
    const bridge = await startBrowserBridge(getTabCdp, listTabs, showPanel, togglePanel);
    console.log(`✓ Browser bridge listening on port ${bridge.port}`);
  } catch (err) {
    console.warn(
      `⚠ Browser bridge failed to start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ── Load chatbot — retry until Next.js is ready ──
  win.webContents.on("did-fail-load", () => {
    if (!isQuitting) setTimeout(() => win?.loadURL(CHATBOT_URL), 1_500);
  });
  void win.loadURL(CHATBOT_URL);

  // ── Tray ──
  const icon = makeIcon(false);
  tray = new Tray(icon);
  if (icon.isEmpty()) tray.setTitle("▽");
  tray.setToolTip(`${SERVICE_NAME} — starting…`);
  tray.setContextMenu(buildMenu(false));
  tray.on("click", () => {
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
        win.focus();
      }
    }
  });

  startServers();
  void startOpenViking();
  startNextJs();
  setInterval(checkHealth, 5_000);
});

function killGroup(proc: ChildProcess | null): void {
  if (!proc?.pid) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill("SIGTERM");
  }
}

app.on("before-quit", () => {
  isQuitting = true;
  try {
    unlinkSync(BROWSER_BRIDGE_PORT_FILE);
  } catch {
    // ignore — file may not exist if bridge never started
  }
  killGroup(serversProcess);
  killGroup(nextProcess);
  if (ovProcess) {
    try {
      ovProcess.kill("SIGTERM");
    } catch {}
    void rm(OPENVIKING_PORT_FILE, { force: true }).catch(() => {});
  }
  // Flush localStorage + cookies so Okta/SSO sessions survive restarts
  const quitSession = session.fromPartition("persist:browser-profile");
  quitSession.flushStorageData();
  void quitSession.cookies.flushStore().then(() => setTimeout(() => process.exit(0), 300));
});

// Stay alive when all windows are closed (window is hidden to tray)
app.on("window-all-closed", () => {
  // intentionally empty
});
