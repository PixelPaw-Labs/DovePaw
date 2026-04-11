import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { PluginManagementContent } from "../plugin-management-content";
import type { PluginRecord } from "@@/lib/plugin-schemas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PLUGIN: PluginRecord = {
  name: "test-plugin",
  path: "/path/to/test-plugin",
  gitUrl: "git@github.com:user/test-plugin",
  installedAt: "2026-01-01T00:00:00.000Z",
  agentNames: ["agent-a", "agent-b"],
};

// Pre-computed URL strings — avoid template literals as computed property keys.
const PLUGIN_LIST_URL = "/api/settings/plugins";
const PLUGIN_UPDATE_URL = "/api/settings/plugins/" + PLUGIN.name + "/update";
const PLUGIN_SYNC_URL = "/api/settings/plugins/" + PLUGIN.name + "/update?action=sync";
const PLUGIN_DELETE_URL = "/api/settings/plugins/" + PLUGIN.name;
const RESTART_URL = "/api/servers/restart";

// ─── fetch mock ───────────────────────────────────────────────────────────────

/** Returns the most specific (longest matching key) response. */
function mockFetch(responses: Record<string, { ok: boolean; body: unknown }>) {
  return vi.fn(async (url: string) => {
    const key =
      Object.keys(responses)
        .filter((k) => url.includes(k))
        .toSorted((a, b) => b.length - a.length)[0] ?? url;
    const entry = responses[key] ?? { ok: true, body: {} };
    return { ok: entry.ok, json: async () => entry.body } as Response;
  });
}

function restartCallCount(mock: ReturnType<typeof vi.fn>): number {
  return (mock.mock.calls as [string][]).filter(([url]) => url.includes(RESTART_URL)).length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PluginManagementContent — server restart wiring", () => {
  it("calls /api/servers/restart after Update action", async () => {
    const fetchMock = mockFetch({
      [PLUGIN_LIST_URL]: { ok: true, body: { plugins: [PLUGIN] } },
      [PLUGIN_UPDATE_URL]: { ok: true, body: { plugin: PLUGIN } },
      [RESTART_URL]: { ok: true, body: { ok: true, pid: 1 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PluginManagementContent initialPlugins={[PLUGIN]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Update"));
    });

    await waitFor(() => expect(restartCallCount(fetchMock)).toBeGreaterThan(0));
  });

  it("calls /api/servers/restart after Sync action", async () => {
    const fetchMock = mockFetch({
      [PLUGIN_LIST_URL]: { ok: true, body: { plugins: [PLUGIN] } },
      [PLUGIN_SYNC_URL]: { ok: true, body: { plugin: PLUGIN } },
      [RESTART_URL]: { ok: true, body: { ok: true, pid: 1 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PluginManagementContent initialPlugins={[PLUGIN]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Sync"));
    });

    await waitFor(() => expect(restartCallCount(fetchMock)).toBeGreaterThan(0));
  });

  it("calls /api/servers/restart after Remove confirm", async () => {
    const fetchMock = mockFetch({
      [PLUGIN_LIST_URL]: { ok: true, body: { plugins: [PLUGIN] } },
      [PLUGIN_DELETE_URL]: { ok: true, body: { ok: true } },
      [RESTART_URL]: { ok: true, body: { ok: true, pid: 1 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PluginManagementContent initialPlugins={[PLUGIN]} />);

    const removeBtn = screen.getByTitle("Remove plugin from registry");
    fireEvent.click(removeBtn); // enter confirm state
    await act(async () => {
      fireEvent.click(removeBtn); // confirm
    });

    await waitFor(() => expect(restartCallCount(fetchMock)).toBeGreaterThan(0));
  });

  it("shows notice with agent count after plugin is added", async () => {
    const fetchMock = mockFetch({
      [PLUGIN_LIST_URL]: { ok: true, body: { plugin: PLUGIN } },
      [RESTART_URL]: { ok: true, body: { ok: true, pid: 1 } },
    });
    vi.stubGlobal("fetch", fetchMock);

    // Render with a plugin so the empty-state "Add Plugin" button is absent
    // — only the header button remains.
    render(<PluginManagementContent initialPlugins={[PLUGIN]} />);

    fireEvent.click(screen.getByText("Add Plugin"));

    fireEvent.change(screen.getByPlaceholderText(/DovePaw-Plugins/), {
      target: { value: "/local/path" },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Add"));
    });

    await waitFor(() => expect(screen.getByText(/Registered 2 agents/)).toBeTruthy());
    expect(screen.getByText(/servers restarting/i)).toBeTruthy();
  });

  it("notice auto-clears after 5 seconds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = mockFetch({
        [PLUGIN_LIST_URL]: { ok: true, body: { plugins: [PLUGIN] } },
        [PLUGIN_UPDATE_URL]: { ok: true, body: { plugin: PLUGIN } },
        [RESTART_URL]: { ok: true, body: { ok: true, pid: 1 } },
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<PluginManagementContent initialPlugins={[PLUGIN]} />);

      await act(async () => {
        fireEvent.click(screen.getByText("Update"));
        // Flush microtasks so callPluginAction and restartServers resolve
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Advance past the 5 s auto-clear
      await act(async () => {
        vi.advanceTimersByTime(5001);
      });

      expect(screen.queryByText(/servers restarting/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
