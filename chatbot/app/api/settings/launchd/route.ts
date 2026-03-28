import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { AGENTS } from "@@/lib/agents";
import { plistLabel } from "@@/lib/plist-generate";
import {
  agentPlistPath,
  isLoaded,
  writePlist,
  loadAgent,
  unloadAgent,
  installAgent,
  uninstallAgent,
} from "@/lib/launchd";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { join } from "node:path";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agentName");

  // Single-agent mode
  if (agentName) {
    const agent = AGENTS.find((a) => a.name === agentName);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const plistPath = agentPlistPath(agent.name);
    return NextResponse.json({
      plistExists: existsSync(plistPath),
      loaded: await isLoaded(agent.label),
      plistPath,
    });
  }

  // All-agents mode
  const entries = await Promise.all(
    AGENTS.map(async (agent) => {
      const plistPath = agentPlistPath(agent.name);
      return [
        agent.name,
        { plistExists: existsSync(plistPath), loaded: await isLoaded(agent.label), plistPath },
      ] as const;
    }),
  );
  return NextResponse.json({ agents: Object.fromEntries(entries) });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { agentName?: string; action?: string };
  const { agentName, action } = body;

  const agent = AGENTS.find((a) => a.name === agentName);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const label = plistLabel(agent);
  const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);

  switch (action) {
    case "upload": {
      writePlist(agent);
      break;
    }
    case "load": {
      await loadAgent(agent);
      break;
    }
    case "unload": {
      await unloadAgent(agent);
      break;
    }
    case "delete": {
      await uninstallAgent(agent);
      break;
    }
    case "install": {
      await installAgent(agent);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  return NextResponse.json({
    plistExists: existsSync(plistPath),
    loaded: await isLoaded(agent.label),
    plistPath,
  });
}
