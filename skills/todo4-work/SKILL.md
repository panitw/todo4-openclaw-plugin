---
name: todo4-work
description: "How to work with a user's Todo4 tasks. Load this whenever the user mentions Todo4, their task list, their todo list, or asks you to create/list/update/organize/plan/triage tasks (e.g. 'create a task', 'what's on my list', 'plan my week', 'triage my inbox', 'follow up on X', 'break this down'). The Todo4 MCP server is the ONLY way to access Todo4 data — this skill tells you which MCP tools to call and when."
---

# Working with Todo4

## CRITICAL: Todo4 lives behind MCP tools — nothing else

When the user asks anything about their Todo4 tasks, you **must** use the Todo4 MCP tools listed below. Do **NOT**:

- Call `curl`, `wget`, or other HTTP clients against `https://todo4.io` — the API requires an agent bearer token that lives in `~/.openclaw/.env` and the endpoints expect specific envelopes. Trying to hand-craft HTTP calls will waste turns and fail.
- Open the Todo4 web UI in a browser to scrape — that's the human surface, not the agent's.
- Shell out to `bash`/`ls`/`grep`/`cat ~/.openclaw/...` to "find" Todo4 — the tools are already loaded into your toolset; you don't need to discover them from the filesystem.

If the Todo4 MCP tools don't seem available, call the `todo4_status` plugin tool and report its output to the user — don't improvise another path.

## The MCP tools you have

The Todo4 MCP server is configured under the `todo4` key. The tools exposed to you have **no prefix** — call them by their bare name (e.g. `query_tasks`, not `todo4:query_tasks` or `todo4.query_tasks`).

There are only **5 tools**. Reads and writes are each one dispatcher tool with an `action` parameter:

| Tool | Purpose |
|---|---|
| `get_platform_info` | Discover capabilities, connected agents, and available features. Call this first if you're unsure what's possible. |
| `query_tasks` | Read tasks. `action: "list"` returns filtered/paginated results; `action: "get"` fetches one task by `taskId` (includes subtasks, comments, history). |
| `mutate_task` | Change tasks. `action: "create"` adds one (`title`+`priority`) or up to 20 (`tasks` array) with duplicate detection. `action: "update"` edits fields, manages subtasks/comments, and closes/deletes — runs as ordered steps and returns per-step status. |
| `notify_human` | Send a message to the user's Todo4 inbox. Use for blockers, ambiguous input, or things the user explicitly asked you to flag. |
| `open_website` | Generate a one-time login URL so the user can open Todo4 in the browser already signed in. |

### query_tasks at a glance

- List: `query_tasks({ action: "list", status?, priority?, tags?, dueAfter?, dueBefore?, page?, limit? })` — all filters optional. `status` accepts comma-separated values (e.g. `"open,in_progress"`).
- Get one: `query_tasks({ action: "get", taskId })` — returns the full task with subtasks, comments, history.

### mutate_task at a glance

- Create one: `mutate_task({ action: "create", title, priority, description?, due_date?, tags?, recurrence?, reference_url? })`. If the response carries `duplicatesFound: true`, retry with `skip_duplicate_check: true` only after confirming with the user.
- Create batch: `mutate_task({ action: "create", tasks: [{ title, priority, ... }, ...] })` (1–20 items). Don't mix top-level single-task fields with `tasks` — the tool will reject it.
- Edit fields: `mutate_task({ action: "update", task_id, title?, priority?, due_date?, tags?, ... })`.
- Add/complete subtasks, post a comment: `mutate_task({ action: "update", task_id, add_subtasks?, complete_subtask_ids?, comment? })`. Combine freely — they execute in a fixed order: fields → add_subtasks → complete_subtask_ids → comment → close → delete.
- Close: `mutate_task({ action: "update", task_id, status: "closed", completion_note?, force? })`. Use `force: true` only if you've confirmed with the user that incomplete subtasks should be ignored.
- Soft-delete: `mutate_task({ action: "update", task_id, status: "deleted" })`.

The `update` response carries a `steps` array — read it to confirm each requested operation succeeded; on first failure, subsequent steps are skipped.

## Principles

**One task = one outcome.** A task names a finishable outcome, not a topic. Rewrite "Q2 report" as "Draft Q2 revenue summary for Monday's exec sync."

**Due dates are commitments, not wishes.** Only set a due date if missing it has a consequence.

**Notify sparingly.** `notify_human` is for things the user needs to see now. Routine progress belongs in task comments (or no update at all).

**Confirm before destructive changes.** Never close, delete, or reassign a task without explicit user approval.

## When to use each feature

| Feature | Use when | Don't use for |
|---|---|---|
| **Subtasks** | A single task needs 2–6 concrete steps with one rollup status | Long-running initiatives (use separate tasks + a shared tag) |
| **Tags** | Grouping across projects, clients, or themes (`#client-acme`, `#research`) | One-off context (put it in the description) |
| **Priority** | Distinguishing "today vs. this week vs. someday" | Labeling every task — only mark the top ~20% |
| **Recurrence** | Habits and reviews that repeat on a schedule | Multi-step projects that happen to recur |
| **Reference URL** | Linking to the source of truth (ticket, doc, PR) | Screenshots or copy-paste of content |
| **Description** | Acceptance criteria, links, context the user needs to pick up the task cold | Task history — use comments for that |

## Common workflows

**"Show me my tasks" / "Get task list"**
→ `query_tasks({ action: "list" })` for everything, or `query_tasks({ action: "list", status: "open" })` for active only. Present a short summary, not a dump.

**"Plan my week"**
1. `query_tasks({ action: "list", status: "open", dueBefore: "<next Sunday>" })`.
2. Group by priority and due date. Surface overdue first, then due this week.
3. Ask the user which to reschedule, delegate, or drop — one decision at a time.
4. Apply changes with `mutate_task({ action: "update", task_id, ... })`.

**"Triage my inbox"**
1. `query_tasks({ action: "list", status: "waiting_for_human,blocked" })`.
2. For each, propose: close, snooze, break into subtasks, or hand back via `notify_human`.
3. Never auto-close. Confirm with the user first.

**"Break this down"**
1. Restate the goal as a single outcome.
2. Propose 3–6 subtasks ordered by dependency.
3. Confirm, then call `mutate_task({ action: "create", title, priority, ... })` for the parent, then `mutate_task({ action: "update", task_id, add_subtasks: [...] })` to attach them.

**"Follow up on X"**
1. Create a task (`mutate_task action: "create"`) with a due date tied to the reason you're following up.
2. Put the "why" in the description.
3. Add the source `reference_url`.

**"Mark this done"**
→ `mutate_task({ action: "update", task_id, status: "closed", completion_note?: "..." })`. If the response shows `incomplete_subtasks`, surface that to the user before retrying with `force: true`.

## Anti-patterns

- Task titled "Ask John about Y" with no due date — it will rot. Set a date.
- Dumping a long meeting transcript into a description — summarize decisions, link the transcript.
- Using `notify_human` as a progress log — users will mute you.
- Closing tasks without explicit user approval.
- Calling `mutate_task` with `action: "create"` AND a `tasks` array AND top-level `title` — the tool rejects it. Choose one shape.

## If something goes wrong

1. MCP tool returns an auth error → the agent token expired or the MCP config is stale. Ask the user to restart OpenClaw, then try again. If still failing, call `todo4_status` (plugin tool, with prefix) to diagnose.
2. You can't find `query_tasks` / `mutate_task` in your toolset → the Todo4 MCP server isn't connected. Call `todo4_status`; if `configured: false`, run the `todo4-onboard` skill (or call the `todo4_register` plugin tool to start onboarding directly).
3. You're tempted to reach for `curl`, `bash`, or a browser → go back to the table above. Every Todo4 operation maps to one of the 5 MCP tools.
