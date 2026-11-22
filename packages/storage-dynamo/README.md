# @purr/storage-dynamo

The DynamoDB implementation of every Purr storage port. `createDynamoStorage({ tableName, client?, endpoint? })` returns a `Storage`; it passes the same `@purr/contracts` suite as the in-memory adapter. This is the only package that imports the DynamoDB SDK.

## Table

One table, string keys `PK` / `SK`, and one global secondary index `GSI1` (`GSI1PK` / `GSI1SK`, all attributes projected), on-demand billing. `createTableInput(tableName)` returns the exact `CreateTable` input (the tests use it; the CDK stack declares the same shape).

Domain objects are stored as the item's own attributes next to the key attributes, so a read just strips `PK`/`SK`/`GSI1PK`/`GSI1SK` back off. Every expression uses `#name` placeholders, because `name`, `state`, `version`, `rank` and `labels` are all reserved words.

## Key layout

| Entity          | PK                     | SK                                       | GSI1PK                      | GSI1SK                                |
| --------------- | ---------------------- | ---------------------------------------- | --------------------------- | ------------------------------------- |
| Project         | `PROJECT#<id>`         | `META`                                   | `PROJECTS`                  | `<prefix>`                            |
| Prefix lookup   | `PREFIX#<prefix>`      | `META`                                   |                             |                                       |
| Project counter | `COUNTER#<projectId>`  | `META`                                   |                             |                                       |
| Task            | `TASK#<ref>`           | `META`                                   | `PROJECT#<projectId>#TASKS` | `<projectRank>#<sequence, 10 digits>` |
| Child link      | `TASK#<parent>`        | `CHILD#<sequence, 10 digits>#<childRef>` |                             |                                       |
| Comment         | `TASK#<ref>`           | `COMMENT#<createdAt>#<id>`               |                             |                                       |
| Activity        | `TASK#<ref>#ACTIVITY`  | `<at>#<id>`                              |                             |                                       |
| Epic            | `EPIC#<ref>`           | `META`                                   | `EPICS`                     | `<epic number, 10 digits>`            |
| Epic counter    | `COUNTER#EPIC`         | `META`                                   |                             |                                       |
| Epic member     | `EPIC#<epicRef>`       | `MEMBER#<taskRef>`                       | `EPIC#<epicRef>#MEMBERS`    | `<rank>#<taskRef>`                    |
| Board card      | `BOARD`                | `<kind>#<id>`                            |                             |                                       |
| API key         | `APIKEY#<sha-256 hex>` | `META`                                   |                             |                                       |

Ranks are base-62 alphanumerics, which all sort after `#`, so `<rank>#<tiebreak>` orders exactly as the rank does. The adapter refuses any other rank (`ValidationError`).

## Access patterns

| Operation              | How                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects.get(prefix)` | `GetItem` the prefix lookup, then `GetItem` the project                                                                                                          |
| `projects.getById`     | `GetItem`                                                                                                                                                        |
| `projects.list`        | Query GSI1 `PROJECTS` (prefix order); archived filtered client-side                                                                                              |
| `tasks.get`            | `GetItem` `TASK#<ref>`                                                                                                                                           |
| `tasks.getMany`        | `BatchGetItem`, chunks of 100, unprocessed keys retried; input order kept, missing refs omitted                                                                  |
| `tasks.listByProject`  | Query GSI1 `PROJECT#<id>#TASKS`: projectRank order. State and label filters apply as items are read, and the page still fills to `limit`                         |
| `tasks.moveInProject`  | Rewrites the one task item; the index follows, so only that item changes                                                                                         |
| `tasks.listChildren`   | Query `TASK#<parent>` for `CHILD#`, then `BatchGetItem`                                                                                                          |
| `comments.list`        | Query `TASK#<ref>` for `COMMENT#` (createdAt order)                                                                                                              |
| `activity.list`        | Query `TASK#<ref>#ACTIVITY` (time order)                                                                                                                         |
| `epics.list`           | Query GSI1 `EPICS` (numeric order)                                                                                                                               |
| `epics.listByProject`  | Query GSI1 `EPICS` and filter on `projectIds`. The design allows a scan of the small epic set; reading through the index touches only epics, not the whole table |
| `epics.listTasks`      | Query GSI1 `EPIC#<ref>#MEMBERS` (rank order)                                                                                                                     |
| `board.list`           | Query `BOARD`                                                                                                                                                    |
| `apiKeys.findByHash`   | `GetItem`                                                                                                                                                        |

## Writes

- **Counters.** `UpdateItem ADD seq 1` with `UPDATED_NEW` allocates the next task or epic number atomically; twenty concurrent creates get twenty distinct, consecutive numbers. The task is then written with `attribute_not_exists`. A failed write after allocating leaves a gap in the numbering, never a duplicate. An imported `sequence` first raises the counter to at least that number (a conditional `SET`), then writes the task; a taken ref is `AlreadyExistsError`.
- **Multi-item writes** use `TransactWriteItems`: task + child link + activity; project + prefix lookup; comment + a check that the task exists; both sides of a relation + the activity record; epic membership + `task.epics` + `epic.projectIds`; and so on.
- **Optimistic concurrency.** Every rewrite of an existing task, epic or project is a `Put` conditioned on `#version = :expected`. When the caller supplied `expectedVersion` a failed condition is `VersionMismatchError`. When the adapter read the version itself (relations, epic membership, moves, flags) it re-reads and tries again, up to ten times with jitter, then reports `ConflictError`.
- **Error translation.** `ConditionalCheckFailed` and `TransactionCanceled` (read through `CancellationReasons`, so the failing operation decides the error) become `VersionMismatchError`, `AlreadyExistsError`, `NotFoundError` or `ConflictError`. Contention between transactions (`TransactionConflict`) is simply re-sent.

## Cursors

A cursor is the base64url JSON of the key of the last item returned (table key, plus the index key for GSI1 queries). It is only issued when more items remain, and decoding checks that it belongs to the partition being read, so one list's cursor can't be replayed on another (`ValidationError`). Callers treat it as opaque.

## Consistency

Reads of single items, the prefix lookup, comments, activity, children and the board are strongly consistent. Lists served from GSI1 (projects, a project's tasks, epics, an epic's members) are eventually consistent, which the ports allow ("lists and search may lag"); in practice the index catches up within milliseconds.

## Tests

`src/dynamo.contract.test.ts` runs `runStorageContract('dynamo', ...)` and a few DynamoDB-specific cases (batch chunking, filtered paging, cursor replay, concurrent relations and memberships) against DynamoDB Local, creating a fresh uniquely named table per test.

```sh
docker run -d --rm --name purr-dynamodb-local -p 8000:8000 amazon/dynamodb-local
DYNAMO_ENDPOINT=http://localhost:8000 pnpm test   # DYNAMO_ENDPOINT defaults to this
```

If the endpoint is unreachable the contract is skipped with a console message, unless `DYNAMO_REQUIRED=1` (set in CI), when it fails. The codec and cursor helpers have their own unit tests that need no database.
