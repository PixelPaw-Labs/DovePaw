import { app, BrowserWindow, ipcMain, Menu, nativeImage, session, shell, Tray } from "electron";
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

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let serversProcess: ChildProcess | null = null;
let nextProcess: ChildProcess | null = null;
let ovProcess: ChildProcess | null = null;
let isQuitting = false;
let browserPanelVisible = false;

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

/** Compute the screen bounds for the browser overlay window (right half, below the header). */
function browserWinBounds(w: BrowserWindow): Electron.Rectangle {
  const outer = w.getBounds();
  const [contentW, contentH] = w.getContentSize();
  const titleBarH = outer.height - contentH;
  const panelW = Math.floor(contentW / 2);
  return {
    x: outer.x + panelW,
    y: outer.y + titleBarH + BROWSER_HEADER_HEIGHT,
    width: panelW,
    height: contentH - BROWSER_HEADER_HEIGHT,
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

  // ── Main window ──
  const windowState = loadWindowState();
  win = new BrowserWindow({
    ...windowState,
    minWidth: 1200,
    minHeight: 700,
    title: SERVICE_NAME,
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

  const browserWin = new BrowserWindow({
    parent: win, // stays above chat but goes to background with DovePaw
    frame: false,
    show: false,
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Diagnostics — confirm session identity and cookie visibility
  console.log("[browser] session isPersistent:", browserSession.isPersistent());
  console.log("[browser] sessions match:", browserWin.webContents.session === browserSession);
  browserWin.webContents.on("did-navigate", (_e, url) => {
    void browserWin.webContents.session.cookies.get({}).then((all) => {
      const sessionCookies = all.filter((c) => !c.expirationDate);
      console.log(
        `[browser] navigate ${url} — total cookies: ${all.length}, session-only: ${sessionCookies.length}`,
        sessionCookies.map((c) => c.name),
      );
    });
  });

  // Patch navigator.webdriver before any page script reads it
  browserWin.webContents.on("dom-ready", () => {
    void browserWin.webContents.executeJavaScript(
      "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})",
    );
  });

  // Keep browser window aligned with the right half of the main window
  const syncBrowserWinBounds = () => {
    if (browserPanelVisible && win) browserWin.setBounds(browserWinBounds(win));
  };
  win.on("resize", syncBrowserWinBounds);
  win.on("move", syncBrowserWinBounds);

  // ── IPC handlers ──
  let browserPanelEverShown = false;

  const notifyVisibility = (v: boolean) => {
    try {
      win?.webContents.send("browser:visibility-changed", v);
    } catch {
      // renderer not ready yet — ignore
    }
  };

  ipcMain.handle("browser:toggle", () => {
    browserPanelVisible = !browserPanelVisible;
    if (browserPanelVisible && win) {
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
      if (!browserPanelEverShown) {
        browserPanelEverShown = true;
        void browserWin.webContents.loadURL("about:blank");
      }
    } else {
      browserWin.hide();
    }
    notifyVisibility(browserPanelVisible);
    return { visible: browserPanelVisible };
  });

  ipcMain.handle("browser:navigate", async (_event, url: string) => {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (!browserPanelVisible && win) {
      browserPanelVisible = true;
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
      notifyVisibility(true);
    }
    try {
      await browserWin.webContents.loadURL(normalized);
    } catch (err) {
      console.warn(
        `[browser:navigate] failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { ok: true, url: normalized };
  });

  ipcMain.handle("browser:get-url", () => browserWin.webContents.getURL());
  ipcMain.handle("browser:back", () => {
    browserWin.webContents.goBack();
  });
  ipcMain.handle("browser:forward", () => {
    browserWin.webContents.goForward();
  });
  ipcMain.handle("browser:close", () => {
    browserPanelVisible = false;
    browserWin.hide();
    notifyVisibility(false);
    return { visible: false };
  });

  // Semi-transparent overlay: clicks pass through to the chat below
  ipcMain.handle("browser:dim", () => {
    if (!browserPanelVisible) return;
    browserWin.setOpacity(0.5);
    browserWin.setIgnoreMouseEvents(true, { forward: true });
  });

  // Restore full opacity, interactivity, and focus
  ipcMain.handle("browser:undim", () => {
    if (!browserPanelVisible) return;
    browserWin.setOpacity(1);
    browserWin.setIgnoreMouseEvents(false);
    browserWin.focus();
  });

  // ── Start bridge server ──
  const showPanel = () => {
    if (!browserPanelVisible && win) {
      browserPanelVisible = true;
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
      notifyVisibility(true);
    }
  };
  const togglePanel = () => {
    browserPanelVisible = !browserPanelVisible;
    if (browserPanelVisible && win) {
      browserWin.setBounds(browserWinBounds(win));
      browserWin.setOpacity(1);
      browserWin.setIgnoreMouseEvents(false);
      browserWin.show();
    } else {
      browserWin.hide();
    }
    notifyVisibility(browserPanelVisible);
  };

  try {
    const bridge = await startBrowserBridge(browserWin.webContents, showPanel, togglePanel);
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
