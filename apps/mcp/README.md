# Purr MCP server

A stdio [MCP](https://modelcontextprotocol.io) server that gives Claude Code tools over the Purr API: tasks, epics, the priorities board and search. It replaces the Plane MCP.

## Running it

```sh
PURR_URL=https://purr.nakomis.com PURR_API_KEY=... pnpm --dir apps/mcp start
```

| Variable       | Meaning                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PURR_URL`     | The app origin, e.g. `https://purr.nakomis.com` (sandbox: `https://purr.sandbox.nakomis.com`). The client appends `/api`. |
| `PURR_API_KEY` | An agent API key, sent as `x-api-key`. Each key maps to one actor (`claude`, `bau`).                                      |

The server exits with a clear message if either is missing. API errors (`{error:{code,message}}`) come back to Claude as tool errors, not crashes.

## Registering it in meta-mcp

Add a block to `~/repos/nakomis/mcps/meta-mcp/config.toml` (gitignored), adjusting the secret as needed:

```toml
[[mcps]]
name = "purr"
description = "Purr project management (purr.nakomis.com; replaced Plane)"
command = ["pnpm", "--dir", "/Users/martinmu_1/repos/nakomis/purr/apps/mcp", "start"]
env = {PURR_URL = "https://purr.nakomis.com", PURR_API_KEY = "..."}
```

Then `call_mcp(name="purr", tool="pick_up", args={"ref": "HOME-42"})`. The `/start-purr` skill in `skills/start-purr` drives this.

## Tools

Tasks: `get_task`, `list_tasks`, `create_task`, `update_task`, `pick_up`, `set_state`, `add_comment`, `set_points`, `add_label`, `remove_label`, `add_link`, `remove_link`, `add_relation`, `remove_relation`, `set_parent`.
Planning: `search`, `next`, `board`.
Projects and epics: `list_projects`, `get_project`, `list_epics`, `get_epic`, `create_epic`, `update_epic`, `add_to_epic`, `remove_from_epic`, `flag_project_on_epic`.

Outputs are Markdown or compact text with refs throughout. `update_task` and `update_epic` fetch the current version themselves unless you pass one.

## Development

Source is in `src/`: `client.ts` (typed fetch client, injectable for tests), `tools.ts` (tool definitions and `runTool`), `render.ts` (Markdown rendering), `server.ts` and `index.ts` (wiring). Tests use a fake fetch: `pnpm test` from the repo root.
