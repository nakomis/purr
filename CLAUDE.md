# Purr

A serverless replacement for Plane and ATC: tasks, cross-project epics, a priorities board and hybrid search. Design: `docs/superpowers/specs/2026-11-22-purr-design.md`; plan: `docs/superpowers/plans/2026-11-22-purr.md`.

## The one rule

**Storage stays behind the ports.** `packages/domain` defines every interface the app needs (`ports.ts`) and imports no AWS SDK and no other `@purr` package. Only `packages/storage-dynamo` touches the DynamoDB SDK, only `packages/embedder-bedrock` touches Bedrock. `pnpm depcheck` (scripts/check-boundaries.mjs) enforces it in CI. A new adapter (Postgres, say) is ready when it passes `@purr/contracts`' suites; nothing else should change.

## AWS credentials

- Sandbox: `AWS_PROFILE=nakom.is-sandbox` (account 975050268859)
- Production: `AWS_PROFILE=nakom.is-admin` (account 637423226886)
- Region `eu-west-2`. Domains `purr.sandbox.nakomis.com` and `purr.nakomis.com`; the API is `/api/*` on the same CloudFront distribution.

## Repository layout

A pnpm workspace (`packages/*`, `apps/*`, `tools/*`, `infra`). Internal packages are consumed as TypeScript source (`exports: ./src/index.ts`); only the web bundle and the Lambda bundles (esbuild via CDK) are built.

## Testing

- `pnpm test`: Vitest across packages, API, MCP and tools, with v8 coverage (70% minimum).
- `storage-dynamo` runs the storage contract against DynamoDB Local (`DYNAMO_ENDPOINT`, default `http://localhost:8000`; `docker run -p 8000:8000 amazon/dynamodb-local`). CI runs it as a service container.
- `apps/web`: its own Vitest (jsdom). `infra`: Jest.

## Conventions

- British English everywhere.
- "Task" is the domain word (Plane called it a work item). Task refs `PREFIX-n`, epic refs `EPIC-n`.
- Ranks are fractional strings (`packages/domain/src/rank.ts`): moving an item rewrites only that item.
- Domain events drive search indexing (never DynamoDB Streams), and publishing is best-effort: a write never fails because the queue did.

## Architecture diagrams

Source: `docs/architecture/purr.drawio`; SVG auto-regenerated on commit by `.githooks/pre-commit`. After cloning: `git config core.hooksPath .githooks`.
