import { exec } from "../lib/exec.js";

export class JiraClient {
  constructor(
    private cli: string,
    private server: string,
    private assignee: string,
    private sprintPrefix: string,
  ) {}

  async getActiveSprint(): Promise<string | null> {
    const { ok, stdout } = await exec(this.cli, [
      "sprint",
      "list",
      "--state",
      "active",
      "--plain",
      "--no-headers",
    ]);
    if (!ok) return null;
    const line = stdout.split("\n").find((l) => l.includes(this.sprintPrefix));
    if (!line) return null;
    return line.split("\t")[1]?.trim() || null;
  }

  async fetchSprintTickets(sprint: string): Promise<Array<{ key: string; status: string }>> {
    const jql = `assignee = '${this.assignee}' AND sprint = '${sprint}'`;
    const { ok, stdout } = await exec(this.cli, ["issue", "list", "-q", jql, "--raw"]);
    if (!ok || !stdout) return [];
    try {
      const data = JSON.parse(stdout) as Array<{
        key: string;
        fields: { status: { name: string } };
      }>;
      return data.map((item) => ({ key: item.key, status: item.fields.status.name }));
    } catch {
      return [];
    }
  }

  async moveTicket(ticketKey: string, status: string): Promise<boolean> {
    const { ok } = await exec(this.cli, ["issue", "move", ticketKey, status]);
    return ok;
  }

  /** Get the parent ticket key for a sub-task, or null if none. */
  async getParentKey(ticketKey: string): Promise<string | null> {
    const { ok, stdout } = await exec(this.cli, ["issue", "view", ticketKey, "--raw"]);
    if (!ok || !stdout) return null;
    try {
      const data = JSON.parse(stdout) as { fields?: { parent?: { key?: string } } };
      return data.fields?.parent?.key ?? null;
    } catch {
      return null;
    }
  }

  /** Check if a parent ticket has any sub-tasks assigned to this user still in To Do or Backlog. */
  async hasUnfinishedSubtasks(parentKey: string): Promise<boolean> {
    const jql = `parent = '${parentKey}' AND assignee = '${this.assignee}' AND status IN ('To Do', 'Backlog', 'In Progress')`;
    const { ok, stdout, stderr } = await exec(this.cli, ["issue", "list", "-q", jql, "--raw"]);
    if (!ok) {
      // "No result found" means the query succeeded but returned zero rows — not an error
      if (stderr?.includes("No result found")) return false;
      return true; // genuine error — assume unfinished to be safe
    }
    try {
      const data = JSON.parse(stdout) as unknown[];
      return data.length > 0;
    } catch {
      return true; // parse error — assume unfinished to be safe
    }
  }

  /**
   * Move a ticket to In Review and promote its parent if all sub-tasks are done.
   * Returns the set of parent keys that were promoted (for dedup across calls).
   */
  async promoteToReview(
    ticketKey: string,
    log: (msg: string) => void,
    promotedParents?: Set<string>,
  ): Promise<void> {
    const moved = await this.moveTicket(ticketKey, "In Review");
    if (!moved) log(`WARN: Could not move ${ticketKey} to In Review`);

    const parentKey = await this.getParentKey(ticketKey);
    if (parentKey && !promotedParents?.has(parentKey)) {
      const hasUnfinished = await this.hasUnfinishedSubtasks(parentKey);
      if (!hasUnfinished) {
        promotedParents?.add(parentKey);
        const parentMoved = await this.moveTicket(parentKey, "In Review");
        if (parentMoved) log(`PARENT: moved ${parentKey} to In Review (all sub-tasks complete)`);
        else log(`WARN: Could not move parent ${parentKey} to In Review`);
      }
    }
  }

  async addComment(ticketKey: string, body: string): Promise<boolean> {
    const { ok } = await exec(this.cli, ["issue", "comment", "add", ticketKey, "--body", body]);
    return ok;
  }

  ticketUrl(ticketKey: string): string {
    return `${this.server}/browse/${ticketKey}`;
  }
}
