import { contextBridge, ipcRenderer } from "electron";

console.log("[preload] loaded");

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  browser: {
    toggle: () => ipcRenderer.invoke("browser:toggle"),
    navigate: (url: string) => ipcRenderer.invoke("browser:navigate", url),
    getUrl: (): Promise<string> => ipcRenderer.invoke("browser:get-url"),
    dim: () => ipcRenderer.invoke("browser:dim"),
    undim: () => ipcRenderer.invoke("browser:undim"),
    back: () => ipcRenderer.invoke("browser:back"),
    forward: () => ipcRenderer.invoke("browser:forward"),
    close: () => ipcRenderer.invoke("browser:close"),
    onVisibilityChange: (cb: (visible: boolean) => void) => {
      ipcRenderer.on("browser:visibility-changed", (_e, visible: boolean) => cb(visible));
    },
  },
});
