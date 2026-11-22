---

name: start-purr
description: Use when the user invokes "/start-purr" or asks to pick up, start, or work on a Purr task, work item, story, ticket or ref (e.g. HOME-42, CTHU-3), or supplies a Purr, Plane or old Taiga URL. Covers resolving the ref, creating a worktree, moving the task to In progress, and the branch/commit/PR conventions.
---

# start-purr

Pick up a Purr task and begin working on it.

Purr is the serverless project tracker that replaced Plane (which had replaced Taiga). Its web UI is at
`https://purr.nakomis.com`. Tasks **kept their refs** through both migrations, so `HOME-42` means the same task it
always did. Purr's vocabulary: what Plane called a work item or story is a **task**; Plane's modules and "epic"
labels are **epics** (`EPIC-7`), which group tasks across projects.

Tools come from the `purr` MCP, reached through meta-mcp:
`call_mcp(name="purr", tool="pick_up", args={"ref": "HOME-42"})`.
Call `describe_mcp("purr")` if you need the full tool schemas.

## Input formats

The argument may be:

1. **A ref** — `HOME-42` or `JOBS-126`
   Pass directly to `pick_up` — no prior resolution needed. Refs are case-insensitive.

2. **A Purr URL**
   - `https://purr.nakomis.com/tasks/HOME-42` (or any URL with the ref in its path) → the ref is in the path.

3. **An old Plane or Taiga URL**
   - `https://plane.home.nakomis.com/nakomis/browse/HOME-42/` → the ref is in the path.
   - `https://taiga.home.nakomis.com/project/home-infrastructure/us/43` → map the project slug to its prefix
     (`list_projects`; renamed ones: NAKO → NAKIS, RECP → RECIP, LTNG → LIGHT) and use `PREFIX-43`.

4. **A bare number** — `43`
   Infer the project from context (current working directory, recent conversation, branch name). If genuinely ambiguous, ask the user which project before proceeding. Once resolved, call `pick_up("PREFIX-43")`.

5. **Nothing / no argument**
   Call `next` to see what the priorities board says to work on, or ask the user what to work on and use
   `list_tasks` for the most contextually relevant project.

## Workflow

### 0. Create a worktree

Before making any changes, create an isolated git worktree for this task using `EnterWorktree`. This prevents accidental interference with other Claude instances that may be working on different tasks in parallel.

When you finish (successful commit or deliberate abandonment), exit the worktree with `ExitWorktree`, choosing `keep` or `remove` based on whether the work is complete.

### 1–3. Pick up the task (single call)

Call `pick_up(ref="PREFIX-N")`.

This moves the task to "In progress" (or the project's first started state), records the change as the Claude
actor, and returns the whole task as Markdown: title, project, state, priority, points, labels, description,
links, relations, parent and children, epics and every comment. No prior `list_projects` or `get_project` call is
needed. If the task sits in an epic, `get_epic` shows its neighbours and ordering.

### 4. Rename the session

Derive a session name: `{PROJ}-{ref}-{kebab-subject}` where:

- `{PROJ}` = the project prefix from the ref (e.g. HOME, BOOT, JOBS, BCON)
- `{ref}` = the task's number (e.g. `10`, `43`)
- `{kebab-subject}` = the title lowercased, spaces replaced with hyphens, stripped of punctuation, truncated to ~40 chars

Tell the user to run: `/rename {PROJ}-{ref}-{kebab-subject}`

### 5. Q&A and discovery

Unless the task description is exceptionally detailed and unambiguous, do not jump straight into implementation. Instead:

- Summarise the task (title, project, what's being asked)
- Read the relevant code — understand the current state before proposing anything
- Ask Martin any clarifying questions you need: scope, constraints, preferred approach, things to avoid
- Keep it conversational; one or two rounds of Q&A is normal

**No hard-coded values in implementation.** When writing CDK, infrastructure, or any config code, never hard-code environment-specific values such as account IDs, HostedZone IDs, ARNs, domain names, SSM paths, or resource names. All such values must be derived from props, helper functions, or lookups. If you discover a value you need (e.g. a HostedZone ID), find it from the codebase, git history, or existing infrastructure — do not embed it as a literal string.

### 6. Write a plan

Once you have enough context, write a `PLAN.md` in the repository root (or relevant subdirectory) with:

- What you're going to do and why
- Key design decisions and any alternatives considered
- Step-by-step implementation plan, covering every file that will be touched and exactly what changes will be made
- Any migrations, schema changes, or infrastructure touches
- What you're explicitly **not** doing (scope boundaries)

`PLAN.md` must be `.gitignore`d — add it if it isn't already.

**CRITICAL — plan sign-off is mandatory before any implementation.**

Output the full plan content to the conversation (do not just say "I've written PLAN.md") and explicitly ask Martin to confirm he's happy to proceed. Do not write a single line of implementation code until he replies with an explicit go-ahead.

Asking a few clarifying questions and then immediately diving in is NOT sign-off. Summarising the task and then asking "shall I start?" is NOT sign-off. The plan must be written in full, presented in full, and Martin must explicitly approve it before step 7 begins.

### 6a. Decide: implement inline or via shepherd?

**Before writing any code, evaluate whether to use claude-shepherd drones.** This decision should be explicit and deliberate, not left until the end.

#### Use shepherd when:

- Implementation is **well-specified** by the PLAN (exact schemas, interfaces, validation rules)
- Work is **self-contained** (individual files, functions, or constructs)
- Output is **verifiable** (compiles, tests pass, linting passes)
- **No mid-flight Q&A needed** (the spec is detailed enough to code against)
- **Examples**: Lambda handlers, CDK constructs, React components, schema migrations, utility functions

#### Implement inline when:

- Work requires **reading many files** across the codebase to understand context
- You need **interactive feedback** during implementation (refine approach based on discoveries)
- Output is **trivial or procedural** (shorter to write inline than to spec)
- **Examples**: Bug fixes with unclear root cause, refactoring that spans multiple subsystems, architectural decisions

**Cost impact**: Shepherd uses Together Qwen (much cheaper than Claude Opus/Sonnet). Use it wherever the criteria fit — it's the cost-optimised path.

### 7. Implement via shepherd or inline

#### If using shepherd:

1. Write a tight spec for each self-contained piece (see `docs/spec-format.md` in the claude-shepherd repo)
   - Each spec should be one file, one Lambda handler, one CDK construct, etc.
   - Include exact schemas, validation rules, interfaces, expected behaviour
   - Reference the PLAN.md for context
2. Call `drone_generate(spec=..., model="together/Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8", project_path=...)`
3. Poll with `drone_status`, then fetch with `drone_result` and `drone_files`
4. Review the generated output for correctness
5. Apply or iterate (if tests fail or logic is incorrect, reject with feedback)

#### If implementing inline:

Write the code directly, following the patterns and conventions in the existing codebase. Test as you go.

### Cost-optimised: Haiku orchestrator + Sonnet reviewer

For shepherd runs where the current model is already Sonnet, consider delegating the entire shepherd loop to a **Haiku sub-agent**:

- Haiku handles all mechanical work: `drone_generate`, polling, `drone_result`, applying output, running the compile/test gate
- Haiku spawns a **Sonnet sub-agent** only for judgment calls: reviewing generated code for correctness, deciding whether to accept or iterate, writing a corrective spec if needed
- The handoff to Sonnet must include: the original spec, the generated output, and the test results — enough context to verdict without re-reading the codebase
- Cost profile: most tokens at Haiku prices; Sonnet earns its cost only on the parts that need reasoning

## Branch, commit and PR conventions

- Always work on a feature branch, never `main`. Put the ref in the branch name (lower-case) and the PR title, e.g.
  branch `home-42-dns-failover`, PR title `feat(dns): failover records (HOME-42)`.
- Do not add "Co-Authored-By" or "Generated with Claude Code" lines to commits.
- Open a PR when the work is complete so it can be reviewed, and attach it to the task with
  `add_link(ref, url, title="PR")`.

## Notes

- **Always use a worktree** (step 0) to isolate your work from other Claude instances. Martin often has multiple Claude windows open working on different tasks.
- Refs are **per-project**: always use the full `PREFIX-N`.
- **Keep the task's state current** as work progresses: `set_state(ref, "Ready for test")` when the PR is open, `"Done"` only once it's merged _and_ deployed/visible. Standard states: New, Ready, In progress, Ready for test, Done, Archived. Some projects (JOBS, BCON, PROJ, SHEP) have their own — `get_project` lists them.
- Record progress with `add_comment(ref, body)`; adjust estimates with `set_points`, labels with `add_label` / `remove_label`, and use `add_relation` for blockers (`blocks`, `blocked_by`, `relates_to`, `duplicate_of`).
- **Epics** are first-class in Purr (`EPIC-n`), not labelled tasks. They group tasks across projects in an explicit order: `list_epics`, `get_epic`, `add_to_epic`, `remove_from_epic`. A task's _parent_ is separate: it makes a sub-task, e.g. `create_task(project, title, parent="HOME-372")`.
- `search(q)` finds tasks, comments and epics by meaning or keyword; `board` shows the priorities board and `next` says what to work on.
- The MCP server lives in the Purr repo at `~/repos/nakomis/purr/apps/mcp` if you need to add or modify tools.
