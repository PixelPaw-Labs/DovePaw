import { publishStatusToUI } from "./logger.js";

function captureStdout(fn: () => void): string[] {
  const written: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
  }
  return written;
}

describe("publishStatusToUI", () => {
  it("writes a __PROGRESS__ line to stdout", () => {
    const lines = captureStdout(() => publishStatusToUI("Done"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("__PROGRESS__:Done\n");
  });

  it("writes __ARTIFACT__ lines before the __PROGRESS__ line", () => {
    const lines = captureStdout(() => publishStatusToUI("Step", { key: "EC-1", status: "ok" }));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^__ARTIFACT__:/);
    expect(lines[1]).toMatch(/^__ARTIFACT__:/);
    expect(lines[2]).toBe("__PROGRESS__:Step\n");
  });

  it("strips newlines from artifact values", () => {
    const lines = captureStdout(() =>
      publishStatusToUI("Layers", { plan: '{\n  "layers": []\n}' }),
    );
    expect(lines).toHaveLength(2);
    const value = lines[0].slice("__ARTIFACT__:plan:".length, -1);
    expect(value).not.toMatch(/\n/);
    expect(value).not.toMatch(/\r/);
  });

  it("emits nothing extra for empty artifacts map", () => {
    const lines = captureStdout(() => publishStatusToUI("Empty", {}));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("__PROGRESS__:Empty\n");
  });
});
