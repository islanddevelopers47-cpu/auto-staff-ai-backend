# Skills Directory

This directory contains skill definitions that agents can use.
Skills are loaded at startup and made available to agents based on their configuration.

## Adding Skills

Place skill definition files (JSON or YAML) in this directory.
Each skill should define:
- `name` — unique skill identifier
- `description` — what the skill does
- `systemPromptAddition` — text appended to the agent's system prompt when this skill is active

Skills from the OpenClaw project can be ported here by converting their tool definitions.
