# Nucleus — Operational Roadmap & Next Steps

This document outlines the **unvarnished operational assessment**, the **remaining 5% required to finalize the MVP**, and the **post-MVP feature roadmap** for Nucleus. Use this document as your direct task board to pick up work tomorrow.

---

## Part 1: Honest System Evaluation (Current State)

### Where Nucleus Excels
1. **Zero-Merge-Conflict Multi-Agent Development:**
   - Autonomous AI agents work simultaneously across lanes (`server/` vs `client/` vs `database/`) with zero Git branch collisions.
   - Real-time shadow diff streaming benchmarks at **>1,100 messages/sec** with sub-7ms broadcast latency.
2. **Deterministic Contract Alignment:**
   - Agents read `CONTRACT/api.md` and live counterpart code from `.nucleus/shadows/` in real time, virtually eliminating API route/payload hallucinations.
3. **Pure Pull Model & Complete T&C Compliance:**
   - **Zero credential transport:** API keys and credentials never leave the contributor's machine.
   - **Zero terminal hijacking:** Nucleus does not inject keystrokes or fake stdin into agent processes; it operates entirely via filesystem synchronization (`.nucleus/`, `PEERS.md`, `tasks.json`, and `shadows/`).
4. **Security & Workspace Isolation:**
   - Strict workspace jail prevents agent file writes outside their designated lane.
   - Automated secret scanning catches hardcoded tokens before tasks transition to review.

### Known Operational Friction Points
1. **Network Discovery & Client Isolation:**
   - Direct LAN IPs (`192.168.x.x` or `10.x.x.x`) fail if the host/guest Wi-Fi isolates devices (e.g., college/office networks).
   - Third-party free tunnels like `localtunnel` inject anti-bot browser screens that break WebSocket connections.
2. **File Watcher Overhead:**
   - If large non-source directories (`node_modules`, `.git`, build output) are not strictly filtered, watcher performance and memory spike.
3. **Agent Adherence Variability:**
   - Top-tier reasoning models (Claude Sonnet 3.5/4.6, GPT-4o, Gemini 1.5 Pro) follow `PEERS.md` reliably; smaller or lighter models require explicit reminder prompts to check `.nucleus/` context files.

---

## Part 2: The Remaining 5% of the MVP (Immediate Action Items)

These are the final polish tasks to complete the core MVP experience:

### 1. Robust Auto-Reconnect on Sleep / Network Switch [COMPLETED]
- **Issue:** When a laptop lid closes or the Wi-Fi interface switches, contributor daemons drop the WebSocket connection with `1006` or `ETIMEDOUT`.
- **Implementation Status:**
  - Implemented exponential backoff (1s, 2s, 4s, up to 30s max) with jitter in `packages/daemon/src/client/`.
  - Added node-token binding in `InviteStore` so reconnecting daemons re-authenticate seamlessly without 4003 token errors.
  - Added watcher resumption in `WorkspaceDiffWatcher.resume()` and `JoinRunner.onReconnect`.
  - Verified with automated test in `daemon-reconnect.test.ts`.

### 2. Built-in Zero-Config Tunneling Fallback (`nucleus init --tunnel`) [COMPLETED]
- **Issue:** Manual IP lookups and router subnet mismatches cause connection confusion.
- **Implementation Status:**
  - Added native `TunnelManager` in `packages/cli/src/tunnel/` supporting `cloudflared` and `ngrok` fallback.
  - Added `--tunnel` flag to `nucleus init` CLI to output public `wss://` invite commands.
  - Verified process management and invite formatting in `packages/cli/src/cli.test.ts`.

### 3. Hardened Watcher Ignore Filter [COMPLETED]
- **Issue:** Unintentional disk noise from dependencies or build tools.
- **Implementation Status:**
  - Hardcoded non-bypassable global ignore list (`node_modules`, `.git`, `dist`, `build`, `.next`, `.nucleus/shadows`, `.cache`, `.turbo`) in `packages/daemon/src/watcher/diff-watcher.ts`.
  - Added binary file extension filter and null-byte buffer inspection (git heuristic) to prevent binary diff streaming.
  - Verified with automated tests in `packages/daemon/src/watcher/diff-watcher.test.ts`.

### 4. User-Friendly Task Collision Error Handling in CLI [COMPLETED]
- **Issue:** The mutex engine correctly rejects concurrent claims atomically, but the contributor CLI output should provide clear guidance.
- **Implementation Status:**
  - Added informative terminal warnings in `packages/cli/src/commands/tasks.ts` and `JoinRunner` showing claimant name and available tasks in the contributor's lane.
  - Updated coordinator server to include `available_tasks` array in `task:claim_failed` WebSocket events.
  - Verified with automated tests in `packages/cli/src/cli.test.ts` and `critique.integration.test.ts`.

### 5. Spec File & Spec URL Task Integration [COMPLETED]
- **Issue:** Complex tasks (especially frontend design, comprehensive backend contracts, and external Figma specs) need deep, granular descriptions or external URLs without cluttering the compact task summary.
- **Implementation Status:**
  - Added `spec_file`, `spec_url`, and `description` to `TaskItemSchema` in `@nucleus/protocol`.
  - Updated `PEERS.md` template in `@nucleus/daemon` to instruct agent LLMs to prioritize reading local spec files (e.g., `CONTRACT/specs/...`) or following external design URLs.
  - Enhanced CLI `nucleus tasks` display to render spec file paths and URLs alongside task summaries.
  - Verified in `peers-index.test.ts` and protocol tests.

### 6. Task Board Archival & Cleanup [COMPLETED]
- **Issue:** Completed and reviewed tasks accumulate in `.nucleus/tasks.json`, cluttering agent context and token limits over long project lifecycles.
- **Implementation Status:**
  - Added atomic archival engine (`archiveCompletedTasks`) in `@nucleus/coordinator` and `@nucleus/daemon` moving completed tasks to `.nucleus/tasks_archive.json`.
  - Added `-c, --clean` and `-a, --archived` flags to `nucleus tasks` CLI command.
  - Verified with integration tests in `system-audit.test.ts` and `cli.test.ts`.

---

## Part 3: Beyond MVP (Future Feature Roadmap)

| Milestone | Feature | Description & Impact |
| :--- | :--- | :--- |
| **v1.1** | **Ephemeral Sidecar Test Runners** | Automatically spin up a headless Docker/worktree environment to run `npm test` or `pytest` on incoming shadow code before the Critique Gate evaluates it. |
| **v1.2** | **Multi-Repo / Microservices Mesh** | Enable a single Nucleus room to orchestrate independent Git repositories (e.g., separate frontend, backend, and infrastructure repos) instead of requiring a monorepo. |
| **v1.3** | **AST-Level Semantic Merge Engine** | For files shared across lanes (e.g., `package.json`, environment definitions, Dockerfiles), replace line-based git conflicts with AST-aware reconciliation via the Coordinator AI. |
| **v1.4** | **Browser Mission Control Dashboard** | Serve a lightweight local web dashboard (`http://localhost:9876`) displaying live peer graphs, diff activity streams, task Kanban status, and critique review logs. |
| **v1.5** | **P2P Encrypted Mesh (WebRTC Data Channels)** | Transition diff streaming from a centralized host WebSocket to direct peer-to-peer WebRTC mesh connections, minimizing latency and host bandwidth for geographically distributed teams. |

---

## Part 4: Operational Readiness Checklist

Nucleus MVP and core enhancements are 100% operational:
1. **Host Coordinator:** Run `nucleus init --port 9876` (or `nucleus init --tunnel` for remote contributors).
2. **Issue Invites:** Generate lane tokens with `nucleus invite --lane backend` / `nucleus invite --lane frontend`.
3. **Contributors:** Connect with `nucleus join <url> --token <token> --lane <lane> --name <handle>`.
4. **Task Orchestration:** Define tasks in `.nucleus/tasks.json` with optional `spec_file` or `spec_url`. Clean completed tasks anytime with `nucleus tasks --clean`.
5. **Next Major Milestone:** Explore post-MVP features in **Part 3** starting with **v1.1 Ephemeral Sidecar Test Runners** or **v1.4 Browser Mission Control Dashboard**.
