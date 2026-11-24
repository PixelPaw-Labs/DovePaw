#!/usr/bin/env python3
"""
DovePaw -> Google Antigravity Python SDK bridge.

Reads a JSON payload from stdin, runs a single turn via google.antigravity.Agent
with LocalAgentConfig, and emits newline-delimited JSON (NDJSON) events to stdout.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any


def emit(event: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


async def run_agent(payload: dict[str, Any]) -> int:
    from google.antigravity import (
        Agent,
        AgentBehavior,
        BuiltinTools,
        CapabilitiesConfig,
        LocalAgentConfig,
    )
    from google.antigravity.hooks import policy
    from google.antigravity.types import RunCommandConfig, SessionContinuationMode

    prompt = str(payload.get("prompt") or "")
    if not prompt:
        emit({"type": "error", "message": "Empty prompt"})
        return 1

    cwd = str(payload.get("cwd") or os.getcwd())
    extra_dirs = [str(d) for d in (payload.get("additionalDirectories") or []) if d]
    workspaces: list[str] = [cwd, *extra_dirs]

    security_mode = str(payload.get("securityMode") or "autonomous")
    allow_web_tools = bool(payload.get("allowWebTools", False))
    enable_sandbox = bool(payload.get("enableSandbox", security_mode == "supervised"))
    enable_subagents = bool(payload.get("enableSubagents", True))

    web_tools = [BuiltinTools.SEARCH_WEB, BuiltinTools.READ_URL_CONTENT]
    enabled_tools: list[BuiltinTools] | None = None
    disabled_tools: list[BuiltinTools] | None = None
    policies: list[Any]

    if security_mode == "read-only":
        enabled_tools = [
            BuiltinTools.VIEW_FILE,
            BuiltinTools.LIST_DIR,
            BuiltinTools.FIND_FILE,
            BuiltinTools.SEARCH_DIR,
            BuiltinTools.FINISH,
        ]
        if allow_web_tools:
            enabled_tools.extend(web_tools)
        policies = list(policy.workspace_only(workspaces))
    else:
        if not allow_web_tools:
            disabled_tools = web_tools
        policies = [policy.allow_all()]

    capabilities = CapabilitiesConfig(
        enable_subagents=enable_subagents,
        agent_behavior=AgentBehavior.AUTONOMOUS,
        enabled_tools=enabled_tools,
        disabled_tools=disabled_tools,
        run_command_config=RunCommandConfig(enable_sandbox=enable_sandbox),
    )

    raw_skills_paths = payload.get("skillsPaths")
    skills_paths: list[str] | None = None
    if isinstance(raw_skills_paths, list):
        resolved = [os.path.expanduser(str(p)) for p in raw_skills_paths if p]
        existing = [p for p in resolved if os.path.isdir(p)]
        if existing:
            skills_paths = existing
    else:
        default_skills = os.path.expanduser("~/.gemini/config/skills")
        if os.path.isdir(default_skills):
            skills_paths = [default_skills]

    config_kwargs: dict[str, Any] = {
        "capabilities": capabilities,
        "policies": policies,
        "workspaces": workspaces,
    }

    model = payload.get("model")
    if isinstance(model, str) and model.strip():
        config_kwargs["model"] = model.strip()
    else:
        config_kwargs["model"] = "gemini-4-neon"

    system_instructions = payload.get("appendSystemPrompt")
    if isinstance(system_instructions, str) and system_instructions.strip():
        config_kwargs["system_instructions"] = system_instructions.strip()

    resume_session = payload.get("resumeSession")
    session_id = payload.get("sessionId")
    if isinstance(resume_session, str) and resume_session.strip():
        config_kwargs["conversation_id"] = resume_session.strip()
        config_kwargs["session_continuation_mode"] = SessionContinuationMode.CREATE_OR_RESUME
    elif isinstance(session_id, str) and session_id.strip():
        config_kwargs["conversation_id"] = session_id.strip()
        config_kwargs["session_continuation_mode"] = SessionContinuationMode.CREATE_OR_RESUME

    save_dir = payload.get("saveDir")
    if isinstance(save_dir, str) and save_dir.strip():
        os.makedirs(save_dir.strip(), exist_ok=True)
        config_kwargs["save_dir"] = save_dir.strip()

    api_key = payload.get("apiKey")
    if isinstance(api_key, str) and api_key.strip():
        config_kwargs["api_key"] = api_key.strip()

    if skills_paths:
        config_kwargs["skills_paths"] = skills_paths

    if payload.get("vertex") is not None:
        config_kwargs["vertex"] = bool(payload["vertex"])

    project = payload.get("project")
    if isinstance(project, str) and project.strip():
        config_kwargs["project"] = project.strip()

    location = payload.get("location")
    if isinstance(location, str) and location.strip():
        config_kwargs["location"] = location.strip()

    config = LocalAgentConfig(**config_kwargs)

    async with Agent(config) as agent:
        emit({"type": "init", "conversationId": getattr(agent, "conversation_id", None)})
        response = await agent.chat(prompt)
        text = await response.text()
        emit(
            {
                "type": "result",
                "ok": True,
                "text": text or "",
                "conversationId": getattr(agent, "conversation_id", None),
            }
        )
    return 0


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        emit({"type": "error", "message": "No input payload received on stdin"})
        return 1
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        emit({"type": "error", "message": f"Invalid JSON input: {exc}"})
        return 1

    try:
        return asyncio.run(run_agent(payload))
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
