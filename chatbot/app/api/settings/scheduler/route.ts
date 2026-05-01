import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readAgentsConfig } from "@@/lib/agents-config";
import { scheduler } from "@@/lib/scheduler";

type Agent = Awaited<ReturnType<typeof readAgentsConfig>>[number];

const schedulerActionSchema = z.object({
  agentName: z.string().optional(),
  jobId: z.string().optional(),
  action: z.string().optional(),
});

async function getJobStatuses(agent: Agent) {
  if (!agent.scheduledJobs?.length) {
    const label = scheduler.agentLabel(agent);
    const configPath = scheduler.configFilePath(label);
    return {
      legacy: {
        configExists: configPath ? existsSync(configPath) : await scheduler.isAgentLoaded(label),
        loaded: await scheduler.isAgentLoaded(label),
        configPath,
        instruction: "",
        schedule: agent.schedule,
      },
    };
  }
  const labels = agent.scheduledJobs.map((j) => scheduler.jobLabel(agent.name, j.id, j.label));
  const loadedMap = await scheduler.areAgentsLoaded(labels);
  return Object.fromEntries(
    agent.scheduledJobs.map((job, i) => {
      const label = labels[i];
      const configPath = scheduler.configFilePath(label);
      const loaded = loadedMap[label] ?? false;
      return [
        job.id,
        {
          configExists: configPath ? existsSync(configPath) : loaded,
          loaded,
          configPath,
          configLabel: label,
          label: job.label ?? "",
          instruction: job.instruction,
          schedule: job.schedule,
        },
      ];
    }),
  );
}

async function handleAction(
  agent: Agent,
  action: string | undefined,
  jobId: string | undefined,
): Promise<NextResponse | null> {
  if (jobId) {
    const job = agent.scheduledJobs?.find((j) => j.id === jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    switch (action) {
      case "install":
        await scheduler.writeJobConfig(agent, job);
        await scheduler.activateJob(agent, job);
        break;
      case "load":
        await scheduler.activateJob(agent, job);
        break;
      case "unload":
        await scheduler.deactivateJob(agent, job);
        break;
      case "delete":
        await scheduler.deactivateJob(agent, job);
        await scheduler.removeJobConfig(agent, job);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } else {
    switch (action) {
      case "upload":
        await scheduler.writeAgentConfig(agent);
        break;
      case "load":
        await scheduler.loadAgent(agent);
        break;
      case "unload":
        await scheduler.unloadAgent(agent);
        break;
      case "delete":
        await scheduler.uninstallAgent(agent);
        break;
      case "install":
        await scheduler.uninstallAgent(agent);
        await scheduler.installAgent(agent, []);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  }
  return null;
}

export async function GET(request: Request) {
  const agents = await readAgentsConfig();
  const { searchParams } = new URL(request.url);
  const agentName = searchParams.get("agentName");

  if (agentName) {
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    return NextResponse.json({ jobs: await getJobStatuses(agent) });
  }

  const entries = await Promise.all(
    agents.map(async (agent) => [agent.name, { jobs: await getJobStatuses(agent) }] as const),
  );
  return NextResponse.json({ agents: Object.fromEntries(entries) });
}

export async function POST(request: Request) {
  const agents = await readAgentsConfig();
  const { agentName, jobId, action } = schedulerActionSchema.parse(await request.json());

  const agent = agents.find((a) => a.name === agentName);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const errorResponse = await handleAction(agent, action, jobId);
  if (errorResponse) return errorResponse;

  return NextResponse.json({ jobs: await getJobStatuses(agent) });
}
