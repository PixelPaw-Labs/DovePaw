# Spawn Agent Script — Performance Issues

Identified in `chatbot/a2a/lib/spawn.ts` and `packages/agent-sdk/src/claude.ts`.

---

## 1. Unbounded `latestLines` array — memory leak

**File:** `chatbot/a2a/lib/spawn.ts:221`

```ts
runningScripts.set(runId, { phase: "running", promise, latestLines });
```

`latestLines` accumulates every stdout line until the script finishes. `awaitScript` only reads the last 10 (`slice(-10)`), but the array is never capped. A verbose, long-running agent can allocate hundreds of MB with no bound.

**Fix:** Cap the array — keep only the last ~200 lines, dropping older ones as new ones arrive.

---

## 2. String concatenation `+=` in the `data` hot path — GC pressure

**File:** `chatbot/a2a/lib/spawn.ts:168`

```ts
stdoutBuf += chunk.toString();
```

Every `data` event does an O(n) string copy to grow the buffer. Under high-throughput scripts this creates many short-lived strings and GC pressure. By contrast, `spawnClaude` in `claude.ts` correctly uses `chunks.push(data)` (Buffer array) and defers `Buffer.concat` to close — that's the right pattern.

**Fix:** Use `Buffer[]` push in `data` handlers and split on `close`.

---

## 3. Timer not cleared in `awaitScript` — delayed GC / event loop pin

**File:** `chatbot/a2a/lib/spawn.ts:254`

```ts
new Promise<typeof timeoutResult>((resolve) =>
  setTimeout(() => resolve(timeoutResult), SCRIPT_POLL_TIMEOUT_MS),
),
```

When the script finishes before the 30s timeout, the `setTimeout` keeps running (and its closure stays referenced) for up to 30 extra seconds per poll. Harmless semantically but delays GC and keeps the event loop alive unnecessarily.

**Fix:**

```ts
let timerId: ReturnType<typeof setTimeout>;
const result = await Promise.race([
  state.promise.then((output): ScriptCompletedContent => {
    clearTimeout(timerId);
    return { status: "completed", runId, output };
  }),
  new Promise<typeof timeoutResult>((resolve) => {
    timerId = setTimeout(() => resolve(timeoutResult), SCRIPT_POLL_TIMEOUT_MS);
  }),
]);
```

---

## 4. I/O-driven CPU spike — manual line-splitting in `data` handlers

**File:** `chatbot/a2a/lib/spawn.ts:168–180`

```ts
stdoutBuf += chunk.toString(); // O(n) string copy — grows every event
const parts = stdoutBuf.split("\n"); // O(n) scan over accumulated string
stdoutBuf = parts.pop() ?? "";
```

`data` events are fired by I/O (child process writes). But each handler does synchronous CPU work that scales with total bytes received so far — copying and scanning the entire accumulated buffer. As the script runs and produces more output, each I/O event costs proportionally more CPU. High-throughput child output → CPU spike.

`stderr` has the same pattern at line 178.

**Fix:** Use `readline.createInterface`, which handles line-buffering in native C++ with no per-event string copies:

```ts
import { createInterface } from "node:readline";

const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });
rl.on("line", (line) => {
  const result = processor.process(line, lines);
  if (result) onProgress?.(result.message, result.artifacts);
});

const rlErr = createInterface({ input: proc.stderr!, crlfDelay: Infinity });
rlErr.on("line", (line) => lines.push(`[stderr] ${line}`));
```

CPU per I/O event drops to near zero regardless of how much output the script has produced.

---

## 5. `appendFileSync` in `data` handler — event loop blocking

**File:** `packages/agent-sdk/src/claude.ts:94`

```ts
child.stderr.on("data", (data: Buffer) => {
  if (stderrToLog)
    appendFileSync(stderrToLog, data); // blocking syscall
  else stderrChunks.push(data);
});
```

`appendFileSync` opens, writes, and closes the log file synchronously on every stderr `data` event. The entire Node.js event loop stalls for the duration of each disk write — no other I/O (other agent streams, HTTP requests, SSE) can be processed during that window. Claude CLI is verbose on stderr, so this fires frequently.

**Fix:** Open a write stream once and pipe into it — zero blocking, zero per-chunk overhead:

```ts
import { createWriteStream } from "node:fs";

const logStream = stderrToLog ? createWriteStream(stderrToLog, { flags: "a" }) : null;

child.stderr.on("data", (data: Buffer) => {
  if (logStream) logStream.write(data);
  else stderrChunks.push(data);
});

child.on("close", () => {
  logStream?.end();
  // ...rest of close handler
});
```

---

## Priority

| #   | Issue                                        | Impact                                   | Location       |
| --- | -------------------------------------------- | ---------------------------------------- | -------------- |
| 1   | `appendFileSync` in `data` handler           | Event loop stall on every stderr chunk   | `claude.ts:94` |
| 2   | I/O-driven CPU spike — manual line-splitting | CPU spikes proportional to output volume | `spawn.ts:168` |
| 3   | `+=` string concat in data handler           | GC pressure                              | `spawn.ts:168` |
| 4   | Unbounded `latestLines`                      | Memory leak for verbose/long agents      | `spawn.ts:221` |
| 5   | Timer not cleared on early resolve           | Minor GC delay, event loop pin           | `spawn.ts:254` |
