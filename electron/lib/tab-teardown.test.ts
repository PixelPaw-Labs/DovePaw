import { describe, expect, it, vi } from "vitest";
import { teardownTab, type TeardownView } from "./tab-teardown";

function makeView(isDestroyed = false): {
  view: TeardownView;
  detach: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const detach = vi.fn();
  const close = vi.fn();
  const view: TeardownView = {
    webContents: { debugger: { detach }, isDestroyed: () => isDestroyed, close },
  };
  return { view, detach, close };
}

describe("teardownTab", () => {
  it("detaches the debugger, removes the view, and closes the webContents", () => {
    const { view, detach, close } = makeView();
    const removeChildView = vi.fn();

    teardownTab(view, removeChildView);

    expect(detach).toHaveBeenCalledOnce();
    expect(removeChildView).toHaveBeenCalledWith(view);
    expect(close).toHaveBeenCalledOnce(); // the line that reclaims the renderer
  });

  it("does not close an already-destroyed webContents", () => {
    const { view, close } = makeView(true);

    teardownTab(view, vi.fn());

    expect(close).not.toHaveBeenCalled();
  });

  it("still closes the renderer when detach or removeChildView throw", () => {
    const { view, close } = makeView();
    view.webContents.debugger.detach = vi.fn(() => {
      throw new Error("already detached");
    });
    const removeChildView = vi.fn(() => {
      throw new Error("not attached");
    });

    expect(() => teardownTab(view, removeChildView)).not.toThrow();
    expect(close).toHaveBeenCalledOnce();
  });
});
