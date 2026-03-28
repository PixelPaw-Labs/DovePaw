import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { AGENTS } from "@@/lib/agents";
import { plistLabel } from "@@/lib/plist-generate";
import {
  agentPlistPath,
  isLoaded,
  areAgentsLoaded,
  writePlist,
  loadAgent,
  unloadAgent,
  installAgent,
  uninstallAgent,
} from "@/lib/launchd";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { join } from "node:path";
import { z } from "zod";

const launchdActionSchema = z.object({
  agentName: z.string().optional(),
  action: z.string().optional(),
});

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

  // All-agents mode — single launchctl list call for all labels
  const loadedMap = await areAgentsLoaded(AGENTS.map((a) => a.label));
  const entries = AGENTS.map((agent) => {
    const plistPath = agentPlistPath(agent.name);
    return [
      agent.name,
      { plistExists: existsSync(plistPath), loaded: loadedMap[agent.label] ?? false, plistPath },
    ] as const;
  });
  return NextResponse.json({ agents: Object.fromEntries(entries) });
}

export async function POST(request: Request) {
  const body = launchdActionSchema.parse(await request.json());
  const { agentName, action } = body;

  const agent = AGENTS.find((a) => a.name === agentName);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const label = plistLabel(agent);
  const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);

  switch (action) {
    case "upload": {
      await writePlist(agent);
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
