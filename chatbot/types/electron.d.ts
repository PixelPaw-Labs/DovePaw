// Script-style global declaration — no export needed, Window is extended directly
interface BrowserTabInfo {
  tabId: string;
  url: string;
  title: string;
  active: boolean;
}

interface Window {
  electron?: {
    isElectron: boolean;
    browser: {
      toggle: (sessionId?: string) => Promise<{ visible: boolean }>;
      navigate: (url: string, sessionId?: string) => Promise<{ ok: boolean }>;
      getUrl: () => Promise<string>;
      dim: () => Promise<void>;
      undim: () => Promise<void>;
      back: () => Promise<void>;
      forward: () => Promise<void>;
      close: () => Promise<{ visible: boolean }>;
      setPosition: (xFraction: number) => Promise<void>;
      onVisibilityChange: (cb: (visible: boolean) => void) => void;
      listTabs: () => Promise<BrowserTabInfo[]>;
      switchTab: (sessionId: string) => Promise<{ activeTabId: string }>;
      closeTab: (sessionId: string) => Promise<void>;
      closeAllTabs: () => Promise<void>;
      onTabsChanged: (cb: (tabs: BrowserTabInfo[]) => void) => void;
    };
  };
}
