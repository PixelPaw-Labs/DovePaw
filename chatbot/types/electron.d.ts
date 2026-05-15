// Script-style global declaration — no export needed, Window is extended directly
interface Window {
  electron?: {
    isElectron: boolean;
    browser: {
      toggle: () => Promise<{ visible: boolean }>;
      navigate: (url: string) => Promise<{ ok: boolean }>;
      getUrl: () => Promise<string>;
      dim: () => Promise<void>;
      undim: () => Promise<void>;
      back: () => Promise<void>;
      forward: () => Promise<void>;
      close: () => Promise<{ visible: boolean }>;
      onVisibilityChange: (cb: (visible: boolean) => void) => void;
    };
  };
}
