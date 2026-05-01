import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { readAgentsConfig } from "@@/lib/agents-config";
import { jobPlistLabel, plistLabel } from "@@/lib/plist-generate";
import {
  isAgentLoaded,
  areAgentsLoaded,
  writePlistFile as writePlist,
  loadAgent,
  unloadAgent,
  installAgent,
  uninstallAgent,
  writeJobPlistFile,
  removeJobPlistFile,
  loadJobPlist,
  unloadJobPlist,
  getUid,
} from "@@/lib/installer";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { join } from "node:path";
import { z } from "zod";

const launchdActionSchema = z.object({
  agentName: z.string().optional(),
  jobId: z.string().optional(),
  action: z.string().optional(),
});

/** Build per-job status for a single agent */
async function agentJobStatuses(agent: Awaited<ReturnType<typeof readAgentsConfig>>[number]) {
  if (!agent.scheduledJobs?.length) {
    // Legacy single-plist fallback
    const label = plistLabel(agent);
    const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
    return {
      legacy: {
        plistExists: existsSync(plistPath),
        loaded: await isAgentLoaded(label),
        plistPath,
        instruction: "",
        schedule: agent.schedule,
      },
    };
  }
  const loadedMap = await areAgentsLoaded(
    agent.scheduledJobs.map((j) => jobPlistLabel(agent.name, j.id, j.label)),
  );
  return Object.fromEntries(
    agent.scheduledJobs.map((job) => {
      const label = jobPlistLabel(agent.name, job.id, job.label);
      const plistPath = join(LAUNCH_AGENTS_DIR, `${label}.plist`);
      return [
        job.id,
        {
          plistExists: existsSync(plistPath),
          loaded: loadedMap[label] ?? false,
          plistPath,
          plistLabel: label,
          label: job.label ?? "",
          instruction: job.instruction,
          schedule: job.schedule,
        },
      ];
    }),
  );
}

export async function GET(request: Request) {
  const agents = await readAgentsConfig();
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agentName");

  if (agentName) {
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ jobs: await agentJobStatuses(agent) });
  }

  const entries = await Promise.all(
    agents.map(async (agent) => [agent.name, { jobs: await agentJobStatuses(agent) }] as const),
  );
  return NextResponse.json({ agents: Object.fromEntries(entries) });
}

export async function POST(request: Request) {
  const agents = await readAgentsConfig();
  const body = launchdActionSchema.parse(await request.json());
  const { agentName, jobId, action } = body;

  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const uid = getUid();

  if (jobId) {
    // Job-scoped actions
    const job = agent.scheduledJobs?.find((j) => j.id === jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    switch (action) {
      case "install": {
        await writeJobPlistFile(agent, job);
        await loadJobPlist(agent, job, uid);
        break;
      }
      case "load": {
        await loadJobPlist(agent, job, uid);
        break;
      }
      case "unload": {
        await unloadJobPlist(agent, job, uid);
        break;
      }
      case "delete": {
        await unloadJobPlist(agent, job, uid);
        await removeJobPlistFile(agent, job);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } else {
    // Agent-scoped actions (all jobs)
    switch (action) {
      case "upload": {
        await writePlist(agent);
        break;
      }
      case "load": {
        await loadAgent(agent, uid);
        break;
      }
      case "unload": {
        await unloadAgent(agent, uid);
        break;
      }
      case "delete": {
        await uninstallAgent(agent, uid);
        break;
      }
      case "install": {
        await installAgent(agent, uid, []);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  }

  return NextResponse.json({ jobs: await agentJobStatuses(agent) });
}
