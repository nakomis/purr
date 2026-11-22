# Purr API

JSON over HTTPS. Base path **`/api`** on the app domain (`https://purr.nakomis.com/api`, sandbox
`https://purr.sandbox.nakomis.com/api`). Implemented in `apps/api`; the shapes below are the contract the web UI
and the MCP server build against. Types (`Task`, `Project`, `Epic`, `Comment`, `BoardView`, …) are those in
`packages/domain/src/types.ts` and `packages/domain/src/services/board.ts`, serialised as JSON.

## Authentication

Every route except `GET /api/health` needs one of:

- `Authorization: Bearer <Cognito ID token>` (the web UI; the shared pool, Purr's own client). Actor `martin`.
- `x-api-key: <key>` (agents). Each key maps to one actor (`claude`, `bau`).

Missing or invalid credentials: `401 {"error":{"code":"UNAUTHORISED","message":"..."}}`.

## Errors

`{ "error": { "code": string, "message": string } }` with:

| Status | code |
|---|---|
| 400 | `VALIDATION` (also malformed JSON, unknown fields of the wrong type) |
| 401 | `UNAUTHORISED` |
| 404 | `NOT_FOUND` (also unknown routes: `ROUTE_NOT_FOUND`) |
| 409 | `CONFLICT`, `VERSION_MISMATCH`, `ALREADY_EXISTS` |
| 500 | `INTERNAL` |

Refs are case-insensitive in paths (`home-42` works) and always returned upper-case.

## Routes

| Method and path | Body | Response |
|---|---|---|
| `GET /api/health` | | `{ "ok": true, "version": string }` |
| `GET /api/me` | | `{ "actor": Actor }` |
| **Projects** | | |
| `GET /api/projects?archived=true` | | `{ "items": Project[] }` |
| `POST /api/projects` | `{ prefix, name, description?, states?, labels?, metadata?, icon? }` | `201 Project` |
| `GET /api/projects/{prefix}` | | `Project` |
| `PATCH /api/projects/{prefix}` | `{ version, name?, description?, states?, labels?, metadata?, icon?, archived? }` | `Project` |
| `GET /api/projects/{prefix}/tasks?state=&label=&epic=&all=true&limit=&cursor=` | | `{ "items": Task[], "cursor"?: string }` in project order. `state` is a state name or id (repeatable or comma-separated); open tasks only unless `all=true` or `state` given |
| `POST /api/projects/{prefix}/tasks` | `{ title, description?, state?, labels?, parent?, priority?, points? }` | `201 Task` |
| `POST /api/projects/{prefix}/tasks/reorder` | `{ ref, before? }` (`before` = a task ref; omitted = end) | `Task` |
| `GET /api/projects/{prefix}/epics` | | `{ "items": Epic[] }` (epics flagged on the project) |
| **Tasks** | | |
| `GET /api/tasks/{ref}` | | `TaskDetail` = `Task & { project: { id, prefix, name, icon? }, state: State, comments: Comment[], children: Task[], epics: Epic[] }` |
| `PATCH /api/tasks/{ref}` | `{ version, title?, description?, state?, labels?, parent?, priority?, points? }` | `Task` |
| `POST /api/tasks/{ref}/pick-up` | | `Task` |
| `POST /api/tasks/{ref}/state` | `{ state }` (name or id) | `Task` |
| `PUT /api/tasks/{ref}/points` | `{ points: number \| null }` | `Task` |
| `PUT /api/tasks/{ref}/labels/{name}` / `DELETE` | | `Task` |
| `POST /api/tasks/{ref}/links` | `{ url, title? }` | `201 Link` |
| `DELETE /api/tasks/{ref}/links/{linkId}` | | `Task` |
| `POST /api/tasks/{ref}/relations` | `{ type, target }` | `204` |
| `DELETE /api/tasks/{ref}/relations` | `{ type, target }` | `204` |
| `PUT /api/tasks/{ref}/parent` | `{ parent: TaskRef \| null }` | `Task` |
| `GET /api/tasks/{ref}/children` | | `{ "items": Task[] }` |
| `GET /api/tasks/{ref}/comments?limit=&cursor=` | | `{ "items": Comment[], "cursor"?: string }` (oldest first) |
| `POST /api/tasks/{ref}/comments` | `{ body }` | `201 Comment` |
| `GET /api/tasks/{ref}/epics` | | `{ "items": Epic[] }` |
| `GET /api/tasks/{ref}/activity` | | `{ "items": Activity[] }` |
| **Epics** | | |
| `GET /api/epics?archived=true` | | `{ "items": Epic[] }` |
| `POST /api/epics` | `{ name, description?, projects?: string[] }` (prefixes to flag) | `201 Epic` |
| `GET /api/epics/{ref}` | | `EpicDetail` = `Epic & { projects: { id, prefix, name, icon? }[], tasks: (Task & { epicRank: string, projectPrefix: string })[] }` |
| `PATCH /api/epics/{ref}` | `{ version, name?, description?, state? }` | `Epic` |
| `GET /api/epics/{ref}/tasks` | | `{ "items": (Task & { epicRank: string })[] }` in epic order |
| `PUT /api/epics/{ref}/tasks/{taskRef}` | `{ before? }` | `EpicMember` (adds, or moves if already a member) |
| `DELETE /api/epics/{ref}/tasks/{taskRef}` | | `204` |
| `POST /api/epics/{ref}/tasks/reorder` | `{ ref, before? }` | `EpicMember` |
| `PUT /api/epics/{ref}/projects/{prefix}` / `DELETE` | | `Epic` (DELETE: 409 if tasks from that project remain) |
| **Priorities** | | |
| `GET /api/board?all=true` | | `BoardView` (`columns[]` of `{ column, points, cards[] }`; card = `{ kind, id, key, title, icon?, rank, points, tasks: Task[] }`) |
| `POST /api/board/move` | `{ kind: 'project' \| 'epic', id, column, before? }` (`id`/`before`: project prefix or id, epic ref) | `BoardCard` |
| `DELETE /api/board/{kind}/{id}` | | `204` |
| `GET /api/next` | | `{ next?: Task, runnersUp: Task[] }` |
| `GET /api/priority` | | `{ "items": TaskRef[] }` |
| **Search** | | |
| `GET /api/search?q=&mode=hybrid\|semantic\|fulltext&project=&epic=&kind=task,comment,epic&limit=` | | `{ "items": SearchHit[] }` (`project` = prefix) |

## Icons

`Project.icon` is a path served by the same CloudFront distribution, e.g. `/icons/HOME.png`. The web UI shows it
beside the project's name wherever projects appear; a project without one gets a lettered placeholder.
