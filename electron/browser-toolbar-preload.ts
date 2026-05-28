import { contextBridge, ipcRenderer } from "electron";

// Receive toolbar state from main process and forward to renderer as a CustomEvent.
// CustomEvent is the correct pattern — passing renderer callbacks into contextBridge
// functions does not work reliably across context isolation boundaries.
ipcRenderer.on("toolbar:state", (_e, state) => {
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- preload runs in Electron renderer where window is a full DOM EventTarget; electron tsconfig has no DOM lib
  (window as unknown as EventTarget).dispatchEvent(
    new CustomEvent("toolbar:state", { detail: state as unknown }),
  );
});

// Named "browserToolbar" instead of "toolbar" to avoid shadowing the built-in window.toolbar BarProp
contextBridge.exposeInMainWorld("browserToolbar", {
  back: () => ipcRenderer.invoke("toolbar:back"),
  forward: () => ipcRenderer.invoke("toolbar:forward"),
  reload: () => ipcRenderer.invoke("toolbar:reload"),
  stop: () => ipcRenderer.invoke("toolbar:stop"),
  navigate: (url: string) => ipcRenderer.invoke("toolbar:navigate", url),
  close: () => ipcRenderer.invoke("toolbar:close"),
  switchTab: (sessionId: string) => ipcRenderer.invoke("toolbar:switch-tab", sessionId),
  closeTab: (sessionId: string) => ipcRenderer.invoke("toolbar:close-tab", sessionId),
});
