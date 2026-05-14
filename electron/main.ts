import { app, Menu, nativeImage, shell, Tray } from "electron";
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, resolve } from "node:path";
import { createServersProcess } from "../lib/server-manager";
import { linkAgents } from "../lib/installer";
import {
  DOVEPAW_LOGS_DIR,
  OPENVIKING_PORT_FILE,
  OPENVIKING_SIDECAR_PID_FILE,
  portsFile,
} from "../lib/paths";
import { bootOpenViking } from "../lib/openviking-spawner";
import { getAvailablePort } from "../lib/get-available-port";
import { killStaleProcess, writePidFile } from "../lib/process-orphan-cleanup";

// electron/.dist/main.cjs → ../../ = DovePaw repo root
const REPO_ROOT = resolve(__dirname, "../..");
const NEXT_PORT = 7473;
const PORTS_FILE = portsFile(NEXT_PORT);
const ASSETS_DIR = resolve(__dirname, "../assets");
const LOGS_DIR = DOVEPAW_LOGS_DIR;
const NPM_BIN = "npm";
const CHATBOT_URL = `http://localhost:${NEXT_PORT}`;
const SERVICE_NAME = "DovePaw";

const SIDECAR_CMDLINE_RE = /openviking-server/;

let tray: Tray | null = null;
let serversProcess: ChildProcess | null = null;
let nextProcess: ChildProcess | null = null;
let ovProcess: ChildProcess | null = null;
let isQuitting = false;

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
      label: "Open Chatbot UI",
      click: () => shell.openExternal(CHATBOT_URL),
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

  if (process.platform === "darwin") {
    const dockIcon = makeIcon(true);
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
    app.dock?.hide();
  }

  const icon = makeIcon(false);
  tray = new Tray(icon);
  if (icon.isEmpty()) tray.setTitle("▽");
  tray.setToolTip(`${SERVICE_NAME} — starting…`);
  tray.setContextMenu(buildMenu(false));
  tray.on("click", () => tray?.popUpContextMenu());

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
  killGroup(serversProcess);
  killGroup(nextProcess);
  if (ovProcess) {
    try {
      ovProcess.kill("SIGTERM");
    } catch {}
    void rm(OPENVIKING_PORT_FILE, { force: true }).catch(() => {});
    // PID file intentionally left — killStaleProcess() cleans it on next boot
  }
  setTimeout(() => process.exit(0), 500);
});

// Menubar app — stay alive when no windows are open
app.on("window-all-closed", () => {
  // intentionally empty
});
