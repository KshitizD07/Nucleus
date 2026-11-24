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

### 2. Built-in Zero-Config Tunneling Fallback (`nucleus init --tunnel`)
- **Issue:** Manual IP lookups and router subnet mismatches cause connection confusion.
- **Target Implementation:**
  - Add native support for Cloudflare Tunnels (`cloudflared`) or authenticated ngrok via an optional flag:
    ```powershell
    nucleus init --port 9876 --tunnel
    ```
  - Output an internet-routable invite command (`wss://<subdomain>.trycloudflare.com`) alongside the local Wi-Fi invite.

### 3. Hardened Watcher Ignore Filter
- **Issue:** Unintentional disk noise from dependencies or build tools.
- **Target Implementation:**
  - Hardcode a global non-bypassable ignore list in `packages/daemon/src/watcher/`:
    `**/node_modules/**`, `**/.git/**`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/.nucleus/shadows/**`.
  - Prevent non-code binary files from triggering diff payloads.

### 4. User-Friendly Task Collision Error Handling in CLI
- **Issue:** The mutex engine correctly rejects concurrent claims atomically, but the contributor CLI output should provide clear guidance.
- **Target Implementation:**
  - Return informative messaging:
    ```text
    ⚠️ Task [task-ui-02] was just claimed by Harsh 150ms ago.
    Available tasks in 'frontend' lane: [task-ui-03, task-ui-04].
    ```

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

## Part 4: Tomorrow's Morning Checklist

When resuming work tomorrow:
1. **Terminal 1:** Run `nucleus init --port 9876` in the project root.
2. **Terminal 2:** Connect your backend lane (`nucleus join ...`).
3. **Verify Invites:** Issue fresh tokens with `nucleus invite --lane <lane>` for teammates.
4. **Begin MVP Polish:** Tackle the 4 action items in **Part 2** starting with the auto-reconnect backoff logic.
