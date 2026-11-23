# Multiplayer AI Engineering Room — System Architecture

**Version:** 2.0 (Post-Critique Pull Model & Live Streaming)  
**Scope:** Phases 1–2 only (Private Squad Room + Smart Contract/Critic automation). Public lobbies explicitly out of scope.  
**Design principle:** *Zero central control over contributor CLIs or sessions. The central node never touches credentials, drives child processes, or writes directly to repositories. It orchestrates shared state (contracts, live workspace diff streams, task boards, and structured critique files); each human operates their own official CLI locally.*

---

## 1. High-Level Topology

┌────────────────────────────── INITIATOR MACHINE ──────────────────────────────┐
│                                                                               │
│ ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────────────┐ │
│ │ ROOM COORDINATOR  │ │ CRITIQUE GATE     │ │ INITIATOR'S OWN NODE DAEMON   │ │
│ │ (session state,   │ │ (worktree checks  │ │ (the Initiator also builds    │ │
│ │  contract store,  │ │  + AI critic,     │ │  in a lane, like everyone)    │ │
│ │  live diff feed,  │ │  critique .md     │ └───────────────────────────────┘ │
│ │  task board, log) │ │  generator)       │                                   │
│ └─────────┬─────────┘ └───────────────────┘                                   │
└───────────┼───────────────────────────────────────────────────────────────────┘
            │ WebSocket (TLS 1.3, per-room token auth, signed messages)
            │
   ┌────────┴─────────────┬──────────────────────────┬────────────────────────┐
   │                      │                          │                        │
┌──▼─────────────────┐ ┌──▼─────────────────┐     ┌──▼─────────────────┐   ┌──▼─────────────────┐
│ CONTRIBUTOR 1      │ │ CONTRIBUTOR 2      │ ... │ CONTRIBUTOR N      │   │ LIVE OBSERVER / UI │
│ (own machine,      │ │ (own machine,      │     │ (own machine,      │   │ (TUI or Web feed:  │
│  own CLI & login,  │ │  own CLI & login,  │     │  own CLI & login,  │   │  live diffs, code  │
│  `sphere-node`)    │ │  `sphere-node`)    │     │  `sphere-node`)    │   │  activity, locks)  │
└────────────────────┘ └────────────────────┘     └────────────────────┘   └────────────────────┘

Each participant runs a single lightweight **Node Daemon (`sphere-node`)**. It does NOT spawn, hijack, or wrap the contributor's AI CLI. Instead, it manages local workspace synchronization, broadcasts real-time work-in-progress code diffs so everyone sees what is being built live, and syncs critique review files for the local CLI to ingest.

---

## 2. Component Breakdown

### 2.1 Node Daemon (`sphere-node`) — runs on every participant's machine
A small local background/companion process (Node 20+, ESM). One daemon per room-membership.

Responsibilities:
- **Workspace binding & isolation:** at join time, the human points the daemon at a repository directory. The daemon binds to that path and *nothing else* — all file operations are path-normalized and jailed to it (see §6).
- **Independent Agent Operation (Pull Model):** The daemon *never* drives or injects keystrokes into the contributor's CLI. The contributor opens their official, authorized terminal (Claude Code, Antigravity, Aider, etc.) as usual. The daemon prepares and syncs workspace context files (`CONTRACT/`, `TASKS.json`, `.nucleus/critiques/*.md`) which the human tells their CLI to read.
- **Contract sync:** maintains a local replica of `CONTRACT/` — applies broadcasts, enforces the lock protocol, and alerts the contributor if their local workspace is editing locked files without a lease.
- **Task board sync:** reflects lane assignments, task state, and dependency notifications locally.
- **Live Code & Diff Streaming (Sharing Layer):** Monitors local file system / Git working tree changes. While the human's agent is editing, `sphere-node` streams lightweight live diffs and active file events to the room coordinator so teammates can see code changes and API shapes emerge in real time.
- **Heartbeat & activity reporting:** emits liveness, active task status, and current editing focus every 2s.
- **Local sever switch:** terminates room connection and stops all network sync immediately upon user exit or interrupt.

### 2.2 Room Coordinator (`sphere-coordinator`) — runs on the Initiator's machine
The room's brain. Single source of truth for everything *ephemeral* (durable code state lives in Git, see §2.5).

Responsibilities:
- **Session lifecycle:** room creation, invite tokens (single-use, TTL'd), join/leave, role assignment.
- **Room state store:** in-memory + append-only event log (JSONL). No database needed for Phase 1 — a room is a process; the event log is replayable for crash recovery.
- **Contract store:** owns `CONTRACT/` content + a **lock table** (file → holder → lease expiry). Lease-based mutex (15s heartbeats) so a crashed node can't hold a lock forever.
- **Task board:** task queue with lane ownership, status (`assigned | active | in_review | critiqued | approved | changes_requested`), and dependency edges.
- **Live Activity & Diff Hub (Multiplayer Sharing):** Aggregates real-time workspace diff streams from all active lanes. Fans out a unified activity feed (which files are being edited, live diff previews) to the Initiator and peers so nobody works in an information silo.
- **Broadcast bus:** fans out contract updates, task changes, and heartbeats to all nodes.
- **Dependency watcher:** when a contract change finalizes, it notifies exactly the lanes whose declared dependencies touched the changed contract sections (each task declares `depends_on: [contract sections]` at claim time).

### 2.3 Critique Gate — runs on the Initiator's machine
The review and gate pipeline, triggered when a contributor marks a task as `in_review`:
1. **Automated checks** run in a disposable checkout (git worktree) of the contributor's pushed branch: lint, typecheck, unit tests, secret-scan (gitleaks-class), dependency audit.
2. **AI Critic pass:** the Initiator's local agent receives {original spec, contract excerpt, diff, check results} and produces structured findings (severity, file:line, contract violations, security concerns).
3. **File-Based Critique Delivery (Pull Model):** The critic compiles findings into a standardized markdown file (e.g. `.nucleus/critiques/<task-id>.md`). The coordinator syncs this file to the contributor's workspace.
4. **Resolution:** The contributor instructs their local CLI to read `.nucleus/critiques/<task-id>.md` and patch the issues. No third-party prompt injection or terminal hijacking takes place.
5. **Approval:** Once the gate passes and the Initiator human approves, the contributor merges or the Initiator fast-forwards the approved branch. Rule: **the human Initiator always makes the final merge call.** The gate filters; it does not decide.

### 2.4 Contract Layer (`CONTRACT/`)
A directory in the shared repo, not magic:
```
CONTRACT/
├── api.md            # routes, envelopes, auth scheme
├── schema.prisma     # or schema.sql — frozen DB contract
├── events.md         # socket event catalog: name → payload → emitter → listener
├── env.md            # env var names and conventions (never values)
├── tasks.json        # task board (coordinator-owned)
└── versions/         # append-only snapshots, every broadcast bumps version
```
- **Edit path:** daemon requests lock → coordinator grants lease → holder edits → holder releases → coordinator stamps a new version → broadcast with a diff.
- **Read path:** all other nodes receive the diff immediately and their local agents are instructed to re-read the changed section (version check enforced: an agent working against a stale contract version gets flagged at critique time).
- **MVP simplification:** Phase 1 uses file-watch + whole-file broadcast; diffs and section-level granularity are Phase 2.

### 2.5 Git Boundary (durable state)
- The room touches **zero** repository write access. Code flows: contributor's agent edits local files → human reviews on their own screen → *the human* commits and pushes to their own fork/branch.
- The Critique Gate fetches branches read-only via standard git remotes.
- The "living baseline" is just the main branch; `git pull` is how everyone receives approved merges. The room's value is collapsing the *communication* latency (seconds) that PR comments carry (hours).

---

## 3. Core Flows

### 3.1 Join & trust check
```
Contributor                     Coordinator                    Initiator
    │ 1. open invite link (room id + token) │                     │
    │────────────────────────────────────>│                     │
    │ 2. room manifest: goal, rules,       │                     │
    │    permissions requested,           │                     │
    │    initiator identity proof         │                     │
    │<────────────────────────────────────│                     │
    │ 3. human reviews manifest,          │                     │
    │    selects workspace dir,           │                     │
    │    chooses mode permissions         │                     │
    │──────────explicit accept───────────>│───notify + grant───>│
    │ 4. daemon starts, TLS socket,       │                     │
    │    token auth, hello{capabilities}  │                     │
    │<─────────────room state snapshot─────│                     │
```

### 3.2 Collaborative Work & Live Diff Streaming Loop (The Main Path)
```
Contributor (Human + CLI)      Contributor Daemon (sphere-node)     Coordinator & Peers              Critique Gate
      │                                    │                                  │                            │
      │ 1. Claims task from taskboard     │                                  │                            │
      │    (declares contract deps)        │─── claim_task(deps) ────────────>│ (marks assigned)           │
      │                                    │                                  │                            │
      │ 2. Human tells local CLI:         │                                  │                            │
      │    "Build task from CONTRACT/..." │                                  │                            │
      │    Agent starts editing files...   │                                  │                            │
      │                                    │ 3. Watches workspace changes     │                            │
      │                                    │─── stream_diff(files, patch) ───>│ Fans out live diff stream  │
      │                                    │    (real-time WIP code feed)     │ to Initiator & Room Peers  │
      │                                    │                                  │ (Everyone sees the code!)  │
      │ 4. Task complete: Human commits   │                                  │                            │
      │    & pushes branch to remote       │─── submit_for_review ───────────>│───────────────────────────>│
      │                                    │                                  │   Runs checks + AI critic  │
      │                                    │<── syncs critique markdown ──────│<── critic findings .md ────│
      │ 5. Reads .nucleus/critique.md      │    (.nucleus/critiques/task.md)  │                            │
      │    Tells CLI: "Fix review issues"  │                                  │                            │
      │    ...self-heals until approved... │                                  │                            │
      │ 6. Initiator human approves        │<── task_approved ────────────────│ Initiator human merges ────►│
```

### 3.3 Contract change (lock → edit → broadcast)
Any node (Initiator or Contributor) needing a contract modification:
```
lock_request(file) → grant lease(15s, renewable)
→ edits contract file locally → release → new version + diff
→ broadcast{version, diff, touched_sections}
→ coordinator computes affected lanes from task.depends_on
→ notifies exactly those lanes: "re-read CONTRACT/api.md#auth"
```

### 3.4 Disconnect & Sever
- **Collaborative Autonomy:** There is no "Central-Controlled" mode. No remote party ever injects keystrokes or prompts into another person's shell.
- **Sever / Exit:** Contributor exits the daemon or presses `Ctrl+C` → daemon drops socket and emits `severed` event. Coordinator marks lane inactive, releases any held contract leases, and makes task re-claimable. Local workspace code remains intact under the contributor's Git control.

---

## 4. Message Protocol (all Zod-validated, all signed per-room key)

```
envelope = { room_id, node_id, ts, type, payload, sig }

types:
  session:   hello, room_snapshot, accept, severed, heartbeat
  contract:  lock_req, lock_grant, lock_release, contract_update
  task:      claim, assign, status, critique_req, critique_res, approved
  sharing:   live_diff_stream, file_focus_change, progress_milestone
  gate:      check_result, critic_findings_file
```

- **Live Diff Stream (`sharing:live_diff_stream`):** Dispatched periodically or on file-save by `sphere-node`: `{ lane, active_file, patch_summary, diff_hunk }`. This provides real-time visibility across the entire team without waiting for commits.
- **Heartbeat:** Every node sends `{status: idle|active|review, task_id, contract_version, active_file}` every 2s. Missed 3 beats → lane marked suspect; 10 → dead, locks released, tasks returned to queue.

---

## 5. Technology Choices

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, Node 20+ ESM | Your strongest stack; daemons and coordinator share message schemas |
| Transport | `ws` (raw WebSocket) + TLS 1.3 | Lightweight, event-driven; broadcasts contracts, heartbeats, and live diff streams |
| Message schemas | Zod, shared package | You already use Zod everywhere; schemas are the contract between nodes |
| CLI Compatibility | Pure pull model (no CLI adapters) | Contributor runs their official CLI (`claude`, `agy`, etc.) directly. The daemon only prepares the files on disk |
| Live Diff Stream | `git status` + diff watcher (chokidar / fs.watch) | Streams real-time code changes as lightweight diffs without blocking the user's terminal |
| Workspace jail | path normalization + fs allowlist; Phase 2: container | Enforce that daemon read/write never leaves the project directory |
| Event log | JSONL append-only file | Replayable crash recovery; no DB until Phase 3 |
| Critique runner | git worktrees + spawned check commands | Disposable, parallel, no pollution of anyone's tree |
| Repo | contributors' own forks/branches | Ownership + authorship preserved; gate reads via standard remotes |

---

## 6. Security Model (non-negotiable invariants)

1. **Zero Credential Exposure & Account Protection:** No API keys, session tokens, or provider credentials ever traverse the wire. More importantly, the system never launches or drives a user's CLI via external automation, preventing provider subscription bans.
2. **Workspace jail:** The daemon resolves every path against its bound root; any escape attempt (symlink, `..`, absolute path) → hard error + disconnect. Personal files are unreachable *by construction*.
3. **Local Sovereignty:** The contributor alone decides when to run their CLI, when to commit, and when to push. No remote user or daemon can execute arbitrary commands on a peer machine.
4. **Live Transparency (Multiplayer Visibility):** Real-time diff streaming ensures all teammates have full visibility into what code is being generated across lanes, preventing duplicate work and integration surprises.
5. **Single-use invites, TTL'd, revocable.** Room manifest shown *before* accept; explicit acceptance is the only way in.
6. **Audit trail:** The event log records every lock, contract change, critique, and approval.
7. **Human merge rule:** No automated path from critique-pass → main branch. The Initiator human clicks merge. This is the last line against a poisoned-but-clean-looking diff.

---

## 7. Failure Modes & Handling

| Failure | Behavior |
|---|---|
| Contributor crashes mid-task | Lease expiry releases contract locks; task returns to queue; partial diff preserved in event log; rejoin replays state |
| Initiator crashes | Room pauses (heartbeats lost); nodes hold state; coordinator restart replays JSONL log; locks re-derived from log |
| Contract update mid-task | Lanes on stale version flagged at critique; coordinator can force task pause for critical sections |
| Agent runaway (loop/huge output) | Daemon-side guardrails: token/output caps, wall-clock timeout per task, auto-pause + alert |
| Malicious diff at gate | Automated checks + critic + human merge rule; secret-scan blocks credential exfiltration attempts |
| Network partition | Nodes degrade to local-only (agent keeps working on claimed task); rejoin reconciles via version vectors on contract + task status |

---

## 8. Implementation Order (maps to the 3–5 week streamlined plan)

1. **Weeks 1–2:** Envelope + Zod schemas, lightweight `sphere-node` daemon (workspace jail, contract file-watcher & broadcaster, live git diff streamer), coordinator (rooms, invites, state, JSONL event log, lease mutex).
2. **Week 3:** Task board sync (`TASKS.json`), Critique Gate v1 (worktree + lint/test + AI critic outputting markdown files), live diff feed aggregation.
3. **Week 4:** First dogfood run on Opendoor, 2 nodes (Initiator + 1 Contributor); verify contract locking, live diff visibility, and critique fix loops.
4. **Week 5:** 3–4 nodes on SkillSphere-class decomposition; compare against solo baseline; publish results.

**Deliberately deferred:** P2P transports (Tailscale/WireGuard), container-level sandboxing, complex web UI dashboards (terminal TUI / status feed is sufficient for MVP).
