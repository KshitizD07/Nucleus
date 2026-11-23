# 🧩 Nucleus Real-World Scenarios, Edge Cases & Roadmap Solutions

**Document Version:** 1.0  
**Context:** Practical operational analysis, spontaneous room setups, failure modes, implemented engine guarantees, and solutions for pending features.  
**Audience:** Developers, Contributors, and AI Coding Agents operating within Nucleus.

---

## 📑 Table of Contents

1. [Spontaneous Collaboration & Room Awareness](#1-spontaneous-collaboration--room-awareness)
2. [Network Disconnections & Reconnection Lifecycles](#2-network-disconnections--reconnection-lifecycles)
3. [Task Lifecycle, Idleness & Multitasking](#3-task-lifecycle-idleness--multitasking)
4. [AI Agent Interaction & The "Modal Lock" Problem](#4-ai-agent-interaction--the-modal-lock-problem)
5. [Critical Failure Modes & Protective Guardrails](#5-critical-failure-modes--protective-guardrails)
6. [Audit: Implemented vs. Pending Features & Engineering Solutions](#6-audit-implemented-vs-pending-features--engineering-solutions)

---

## 1. Spontaneous Collaboration & Room Awareness

### Scenario: Unplanned Rooms & Spontaneous Invites
> *"Suppose I'm the initiator, created a room for project X, and I hadn't planned who is working with me beforehand. I randomly texted friends to join. How does the room know who is who, what they are doing, and what code is emerging?"*

### Solution & Protocol Behavior:
1. **Dynamic Invite Generation:**
   The Initiator executes `npx nucleus init --room <project-name>`. Nucleus starts the coordinator and prints lane-scoped join tokens:
   ```bash
   nucleus join --url ws://<ip>:9876 --token <tok-backend> --lane backend --name "Rohan"
   nucleus join --url ws://<ip>:9876 --token <tok-frontend> --lane frontend --name "Aryan"
   ```
2. **Three-Tier Visibility Engine:**
   - **Roster & Focus (`.nucleus/PEERS.md`):** When Rohan joins, every workspace updates its markdown peer directory showing his lane, online status, and active file.
   - **Task Registry (`.nucleus/tasks.json`):** Rohan claims a task, automatically marking it `assigned_to: "Rohan"` and `status: "active"` across all nodes.
   - **Live In-Progress Code Mirror (`.nucleus/shadows/<lane>/`):** As Rohan writes code, his local uncommitted files stream directly into his peers' `.nucleus/shadows/backend/` folder without requiring Git commits or remote pushes.

---

## 2. Network Disconnections & Reconnection Lifecycles

### Scenario A: Contributor Wi-Fi Blip (Client Disconnect)
> *"What if someone loses Wi-Fi connection, gets kicked out, but wants to rejoin?"*

#### Implemented & Planned Handling:
1. **Heartbeat Failure & Lease Protection:** The coordinator detects missed 2-second heartbeats. After a grace period (15s–20s), the node is marked disconnected. Held contract leases expire automatically, preventing deadlocks.
2. **Local Work Remains Safe:** Under the Pure Pull Model, all files on the contributor's laptop remain intact locally.
3. **Reconnection Handshake:** The contributor rejoins (`nucleus join`). The coordinator sends a fresh `session:room_snapshot`, restoring the task board, active contract versions, and peer roster. The contributor's daemon resumes streaming diffs and updates shadows.

---

### Scenario B: Initiator / Coordinator Disconnection
> *"What if I as an Initiator get cut off for a few seconds?"*

#### Implemented & Planned Handling:
1. **Autonomous Local Mode:** Contributors do not crash or stall. Local AI agents continue reading local files, writing code, and running tests.
2. **Contract Edit Freeze:** Requesters cannot acquire new contract locks while the coordinator is unreachable, preventing split-brain contract divergences.
3. **JSONL Audit Recovery:** Upon reconnecting, the coordinator replays its disk-backed append-only event log (`.jsonl`), instantly reconstructing the room's exact pre-blip state.

---

## 3. Task Lifecycle, Idleness & Multitasking

### Scenario: Finishing a Task & Transitioning to New Work
> *"What if someone is done with their work? Do they sit idle or take on new work? If yes, how?"*

#### Operational Flow:
1. **Submission for Review:** The contributor marks the task `in_review` via the task board (`.nucleus/tasks.json` or CLI).
2. **Disposable Critique Gate:** The Initiator's node runs deterministic tests and generates feedback in an isolated Git worktree without touching the main development tree.
3. **Transition to Next Tasks:** Once submitted or approved, the contributor avoids idleness through three paths:
   - **Backlog Self-Service:** Inspects `.nucleus/tasks.json` and claims the next unassigned task.
   - **Cross-Lane Assistance / QA:** Jumps into testing or adversarial verification. Because `.nucleus/shadows/` mirrors peer files locally, a frontend dev can write integration tests against backend shadow controllers without waiting for PR merges.
   - **Collaborative Review:** Reads critique outputs in `.nucleus/critiques/` to help resolve teammate build failures.

---

## 4. AI Agent Interaction & The "Modal Lock" Problem

### Scenario: Interacting with AI Tools (Claude Code / Antigravity) During Room Sessions
> *"While inside an AI session like Claude or Antigravity, the AI holds terminal focus. How do I choose new work or run commands? How do I initiate the AI so it participates as intended?"*

#### Workflow & Solutions:
1. **Natural Language File-Driven Claiming (Method A):**
   - The AI agent reads and edits workspace files natively.
   - Developer prompts: *"Claude, inspect `.nucleus/tasks.json`. What tasks are unassigned? Claim `task-dash-01` for me."*
   - The agent edits the local task file; the local daemon detects the change and notifies the room coordinator.
2. **Two-Terminal / Tab Separation (Method B):**
   - **Tab 1:** Runs `nucleus join ...` as a live background companion.
   - **Tab 2:** Runs the interactive AI coding CLI (`claude`, `agy`).
3. **Context Injection via `CLAUDE.md` and `.nucleus/PEERS.md`:**
   - When the AI tool boots, it reads repository instruction files.
   - `.nucleus/PEERS.md` informs the agent of active peers, warning: *"Do not guess API shapes. Check `.nucleus/shadows/<lane>/` to inspect counterpart code."*

---

## 5. Critical Failure Modes & Protective Guardrails

### A. The "Rogue Agent" / Hallucination Boundary
- **Problem:** An agent gets confused and edits files outside its domain or touches `CONTRACT/` without a lock.
- **Defense:**
  1. Local daemon rejects contract modifications if no valid lease is held.
  2. The Critique Gate evaluates diffs in an isolated Git worktree. Any diff containing unauthorized file modifications is automatically rejected before reaching `main`.

### B. Simultaneous Task Claim Collision
- **Problem:** Two contributors claim the same backlog task at the exact same millisecond.
- **Defense:** The coordinator is the single authoritative sequencer. The first arriving WebSocket message claims the task; the second receives `task:claim_failed { reason: "Already claimed" }`, prompting the runner to pick another item.

### C. Contributor Abandonment / Ghosting
- **Problem:** A contributor claims a critical task, works for 30 minutes, then leaves without committing.
- **Defense:**
  1. Heartbeat timeout marks the node disconnected.
  2. Any held contract leases expire after 15 seconds.
  3. The Initiator can reset task status back to `unassigned`.
  4. The contributor's in-progress uncommitted code was already streamed to `.nucleus/shadows/<lane>/`, allowing teammates to salvage and finish the work.

### D. Hardcoded Secrets in Diffs
- **Problem:** An agent or developer embeds a database secret or API key in their code.
- **Defense:** Deterministic worktree checks run pattern scanners before merge approval, rejecting contaminated diffs with actionable critique messages.

---

## 6. Audit: Implemented Features & Architecture Status

| Feature | Current Implementation Status | How It Works & File Location |
| :--- | :--- | :--- |
| **Room Handshake & Heartbeats** | **Implemented & Tested** | `coordinator-server.ts`, `daemon-client.ts` with 2s heartbeats and token auth. |
| **Automated Reconnection Loop** | **Implemented & Tested** | Exponential backoff (500ms -> 30s) in `packages/daemon/src/client/daemon-client.ts`. |
| **Contract Mutex & Leases** | **Implemented & Tested** | 15s lease locks in `packages/coordinator/src/lock/mutex.ts` & versioned `contract-store.ts`. |
| **Proactive Lease Alerts** | **Implemented & Tested** | `isExpiringSoon` and `getExpiringLocks` in `packages/coordinator/src/lock/mutex.ts`. |
| **Cross-Lane Shadows** | **Implemented & Tested** | Live uncommitted file mirroring in `packages/daemon/src/shadow/shadow-mirror.ts`. |
| **Agent Discovery (`PEERS.md`)** | **Implemented & Tested** | Dynamic markdown context injection in `packages/daemon/src/shadow/peers-index.ts`. |
| **Task Board Engine & CLI** | **Implemented & Tested** | `task-board.ts`, `tasks.ts`, and CLI subcommands `nucleus tasks` & `nucleus claim <id>`. |
| **Disposable Git Worktrees** | **Implemented & Tested** | Detached worktree runner in `packages/critic/src/worktree/worktree-manager.ts`. |
| **Deterministic Secret Scanning** | **Implemented & Tested** | Regex scanner for AWS, Stripe, and private keys in `packages/critic/src/scanner/secret-scanner.ts`. |
| **Pluggable AI Critic Pipeline** | **Implemented & Tested** | `AICriticPipeline` & `LLMCriticProvider` interface in `packages/critic/src/reviewer/ai-critic.ts`. |
| **Network Discovery** | **Implemented** | Local LAN / WebSocket IP (custom URL support in CLI). |

---

### Implementation Blueprint for Key Missing Items

#### 1. CLI Task Commands (`nucleus claim` & `nucleus tasks`)
- **Location:** `packages/cli/src/args.ts` & `packages/cli/src/commands/task.ts`
- **Solution:** Add positional subcommands that read `.nucleus/tasks.json` or dispatch WebSocket events through an ephemeral client instance.

#### 2. Daemon Reconnect Loop
- **Location:** `packages/daemon/src/client/daemon-client.ts`
- **Solution:** Wrap `connect()` in an exponential retry backoff triggered on `close` events when disconnect was not initiated via `sever()`.

#### 3. LLM API Critic Reviewer Pass
- **Location:** `packages/critic/src/reviewer/ai-critic.ts`
- **Solution:** A pluggable module that reads the worktree diff + contract files, posts them to an LLM completion endpoint, and converts findings into `CriticFindingItem` records for `MarkdownCritiqueFormatter`.
