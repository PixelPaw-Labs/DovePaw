import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { SessionInput } from "./session-input.js";

const result = { type: "result", subtype: "success", result: "done" } as SDKMessage;

function backgroundTasks(...tasks: Array<{ ambient?: boolean }>): SDKMessage {
  return {
    type: "system",
    subtype: "background_tasks_changed",
    tasks: tasks.map(({ ambient }, i) => ({
      task_id: `task-${i}`,
      task_type: "local_agent",
      description: "background work",
      ambient,
    })),
  } as SDKMessage;
}

async function startReading(input: SessionInput) {
  const iterator = input[Symbol.asyncIterator]();
  const first = await iterator.next();
  let ended = false;
  const end = iterator.next().then(() => {
    ended = true;
  });
  await Promise.resolve();
  return { first, end, isEnded: () => ended };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("SessionInput", () => {
  it("yields the prompt as a user message", async () => {
    const { first } = await startReading(new SessionInput("hello"));

    expect(first.value as SDKUserMessage).toEqual({
      type: "user",
      message: { role: "user", content: "hello" },
      parent_tool_use_id: null,
    });
  });

  it("stays open until a result arrives", async () => {
    const input = new SessionInput("hello");
    const reading = await startReading(input);

    await settle();
    expect(reading.isEnded()).toBe(false);

    input.observe(result);
    await reading.end;
    expect(reading.isEnded()).toBe(true);
  });

  it("stays open past a result while background tasks are still running", async () => {
    const input = new SessionInput("hello");
    const reading = await startReading(input);

    input.observe(backgroundTasks({}));
    input.observe(result);
    await settle();
    expect(reading.isEnded()).toBe(false);

    input.observe(backgroundTasks());
    await settle();
    expect(reading.isEnded()).toBe(false);

    input.observe(result);
    await reading.end;
    expect(reading.isEnded()).toBe(true);
  });

  it("ignores ambient background tasks", async () => {
    const input = new SessionInput("hello");
    const reading = await startReading(input);

    input.observe(backgroundTasks({ ambient: true }));
    input.observe(result);
    await reading.end;
    expect(reading.isEnded()).toBe(true);
  });

  it("ends when closed directly", async () => {
    const input = new SessionInput("hello");
    const reading = await startReading(input);

    input.close();
    await reading.end;
    expect(reading.isEnded()).toBe(true);
  });
});
