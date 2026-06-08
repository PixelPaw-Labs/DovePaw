import { contextBridge, ipcRenderer } from "electron";

console.log("[preload] loaded");

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  browser: {
    toggle: (sessionId?: string) => ipcRenderer.invoke("browser:toggle", sessionId),
    navigate: (url: string, sessionId?: string) =>
      ipcRenderer.invoke("browser:navigate", url, sessionId),
    getUrl: (): Promise<string> => ipcRenderer.invoke("browser:get-url"),
    dim: () => ipcRenderer.invoke("browser:dim"),
    undim: () => ipcRenderer.invoke("browser:undim"),
    back: () => ipcRenderer.invoke("browser:back"),
    forward: () => ipcRenderer.invoke("browser:forward"),
    close: () => ipcRenderer.invoke("browser:close"),
    onVisibilityChange: (cb: (visible: boolean) => void) => {
      ipcRenderer.on("browser:visibility-changed", (_e, visible: boolean) => cb(visible));
    },
    setPosition: (xFromLeft: number) => ipcRenderer.invoke("browser:set-position", xFromLeft),
    listTabs: (): Promise<{ tabId: string; url: string; title: string; active: boolean }[]> =>
      ipcRenderer.invoke("browser:list-tabs"),
    switchTab: (sessionId: string) => ipcRenderer.invoke("browser:switch-tab", sessionId),
    closeTab: (sessionId: string) => ipcRenderer.invoke("browser:close-tab-for-session", sessionId),
    closeAllTabs: () => ipcRenderer.invoke("browser:close-all-tabs"),
    onTabsChanged: (
      cb: (tabs: { tabId: string; url: string; title: string; active: boolean }[]) => void,
    ) => {
      ipcRenderer.on(
        "browser:tabs-changed",
        (_e, tabs: { tabId: string; url: string; title: string; active: boolean }[]) => cb(tabs),
      );
    },
  },
});
