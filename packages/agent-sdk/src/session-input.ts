import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export class SessionInput implements AsyncIterable<SDKUserMessage> {
  private activeBackgroundTasks = 0;
  private closeInput!: () => void;
  private readonly closed = new Promise<void>((resolve) => {
    this.closeInput = resolve;
  });

  constructor(private readonly prompt: string) {}

  observe(message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "background_tasks_changed") {
      this.activeBackgroundTasks = message.tasks.filter((task) => !task.ambient).length;
    } else if (message.type === "result" && this.activeBackgroundTasks === 0) {
      this.close();
    }
  }

  close(): void {
    this.closeInput();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    yield {
      type: "user",
      message: { role: "user", content: this.prompt },
      parent_tool_use_id: null,
    };
    await this.closed;
  }
}
