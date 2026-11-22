<img src="docs/logo.png" alt="Purr logo" width="200" align="right"/>

# Purr — a serverless replacement for Plane and ATC

Tasks, cross-project epics, a priorities board and hybrid search, built for Claude, BAU and a quick look from Martin. Purr purrs along in the background: almost everything is written through its API by agents, and its web UI is a small read-only window whose front page is the priorities board.

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=purr)

## Table of Contents

<!-- toc -->

- [Architecture Diagram](#architecture-diagram)
- [What it is](#what-it-is)
- [Repository Layout](#repository-layout)
- [Development](#development)
- [Environments](#environments)
- [Deployment](#deployment)
- [Agents and API keys](#agents-and-api-keys)
- [Migrating from Plane](#migrating-from-plane)
- [Consistency notes](#consistency-notes)
- [Architecture Diagrams](#architecture-diagrams)
- [Licence](#licence)
- [Support](#support)

<!-- tocstop -->

## Architecture Diagram

![Architecture](docs/architecture/purr.svg)

## What it is

- **Projects and tasks**: every task belongs to exactly one project and keeps its ref (`HOME-42`), with states, labels, comments, links, relations and sub-tasks.
- **Epics**: first-class and cross-project. A task can be in several epics, an epic can hold tasks from several projects, and each epic orders its tasks independently of their projects.
- **The priorities board** (ATC, built in): Backlog, Up next and In progress columns of project and epic cards, with story points and a "what's next" endpoint for Claude and BAU.
- **Hybrid search**: vector (Bedrock Titan v2) plus full-text, fused with Reciprocal Rank Fusion, over tasks, comments and epics.
- **Serverless on AWS**: Lambda, DynamoDB, S3, SQS, CloudFront and Cognito. Nothing runs, and next to nothing is billed, when idle.

The full design is in [`docs/superpowers/specs/2026-11-22-purr-design.md`](docs/superpowers/specs/2026-11-22-purr-design.md).

## Repository Layout

| Path                        | What                                                                              |
| --------------------------- | --------------------------------------------------------------------------------- |
| `packages/domain`           | Storage-neutral types, rules, services and port interfaces. Depends on no AWS SDK |
| `packages/contracts`        | Conformance suites every adapter must pass                                        |
| `packages/storage-memory`   | In-memory adapter, for tests                                                      |
| `packages/storage-dynamo`   | DynamoDB adapter                                                                  |
| `packages/search`           | Hybrid search engine and S3 index snapshots                                       |
| `packages/embedder-bedrock` | Bedrock Titan embeddings                                                          |
| `apps/api`                  | Lambda handlers: the HTTP API, the authoriser and the search indexer              |
| `apps/web`                  | The web UI (React, Vite, Tailwind)                                                |
| `apps/mcp`                  | The Purr MCP server, for Claude                                                   |
| `tools/migrate-plane`       | One-off importer from Plane and ATC                                               |
| `infra`                     | AWS CDK stacks for sandbox and prod                                               |

## Development

```bash
pnpm install
pnpm test        # Vitest across the workspace, with coverage (70% minimum)
pnpm lint        # Biome
pnpm typecheck
pnpm depcheck    # the storage boundary: only adapters touch AWS SDKs
```

The storage boundary is enforced, not conventional: `scripts/check-boundaries.mjs` fails the build if anything outside `storage-dynamo` imports the DynamoDB SDK, or if the domain imports anything at all.

## Environments

| | Web UI | API |
|---|---|---|
| Sandbox | https://purr.sandbox.nakomis.com | https://purr.sandbox.nakomis.com/api |
| Production | https://purr.nakomis.com | https://purr.nakomis.com/api |

The API is documented in [`docs/api.md`](docs/api.md). Agents send an `x-api-key`; the web UI signs in through the shared Cognito pool and sends the ID token. Only allow-listed emails may sign in (`infra/lib/config.ts`).

## Deployment

Every merge to `main` runs CI, computes one version from the shared deployment tracker, and deploys sandbox, then production behind the `production` environment's approval. Each deploy runs `cdk deploy --all` and then `scripts/deploy-web.sh` (config from SSM, a Vite build, an S3 sync and a CloudFront invalidation), then a health check.

By hand, from `infra/`:

```bash
pnpm run deploy-sandbox   # AWS_PROFILE nakom.is-sandbox
pnpm run deploy-prod      # AWS_PROFILE nakom.is-admin
bash ../scripts/deploy-web.sh sandbox|prod
```

## Agents and API keys

```bash
# Issue a key (stored as a SecureString at /purr/{env}/api-keys/{actor}; only its hash is in the table)
AWS_PROFILE=nakom.is-sandbox pnpm --filter @purr/migrate-plane seed-key -- --env sandbox --actor claude
```

The MCP server is in [`apps/mcp`](apps/mcp/README.md); the `/start-purr` skill in [`skills/start-purr`](skills/start-purr/SKILL.md).

## Migrating from Plane

[`tools/migrate-plane`](tools/migrate-plane) reads Plane's Postgres (read-only) and writes through the domain's ports. It is idempotent, and `--dry-run` imports into memory and prints the verification report.

```bash
PLANE_PG_DSN=postgresql://plane:...@172.29.0.3:5436/plane AWS_PROFILE=nakom.is-sandbox \
  pnpm --filter @purr/migrate-plane migrate -- --target dynamo --table purr-sandbox
pnpm --filter @purr/migrate-plane migrate -- --upload-icons --bucket purr-web-<account>-<env> --profile <profile>
```

## Consistency notes

Lists served from DynamoDB's secondary index (a project's tasks, epics, epic members) are eventually consistent: a task created a moment ago can take a second to appear in its project's list, though fetching it by ref is immediate. Search lags writes by up to about a minute, while the indexer gathers events and rebuilds the snapshot.

## Architecture Diagrams

`docs/architecture/purr.drawio` is the source for the diagram above.
The SVG is auto-regenerated on commit by the pre-commit hook in `.githooks/pre-commit`.

To activate the hook after cloning:

```bash
git config core.hooksPath .githooks
```

## Licence

CC0 1.0 Universal; see [`LICENSE`](LICENSE).

## Support

If you find this useful, please consider buying me a coffee:

[![Donate with PayPal](https://www.paypalobjects.com/en_GB/i/btn/btn_donate_SM.gif)](https://www.paypal.com/donate?hosted_button_id=Q3BESC73EWVNN&custom=purr)
