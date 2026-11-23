# 🛠️ Master Technical & Conceptual Blueprint for Nucleus

**Document Version:** 1.0  
**Scope:** Engineering Reference, Tech Stack, Distributed Systems Theories, and Architecture Patterns for Nucleus  
**Status:** Living Design Specification  

---

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                                 THE NUCLEUS STACK                                    │
├────────────────────┬────────────────────┬────────────────────┬───────────────────────┤
│ Distributed Layer  │   Local Runtime    │   Security/Jail    │   AI Agent Layer      │
│ • Mutex Leases     │ • Node.js 22 (ESM) │ • Path Normalizing │ • File-Based Ingest   │
│ • Event Log (JSONL)│ • TS 5.7 Strict    │ • TLS 1.3 Signed   │ • `.nucleus/PEERS.md` │
│ • Git Worktrees    │ • Native ws engine │ • Single-use TTL   │ • Markdown Critiques  │
└────────────────────┴────────────────────┴────────────────────┴───────────────────────┘
```

---

## 1. Concrete Technology Stack

### A. Core Languages & Runtime
- **Node.js (v20+ / v22 LTS)**: The execution environment for both the room coordinator and contributor node daemons.
- **TypeScript 5.7 (Strict Mode, ESM/NodeNext)**: Full type safety across the entire monorepo with declaration maps and strict null checks.
- **Node.js Native Workspaces**: Zero-overhead monorepo management linking `@nucleus/protocol`, `@nucleus/daemon`, `@nucleus/coordinator`, and `@nucleus/critic` without third-party monorepo bloat.

### B. Networking & Transport
- **Raw WebSockets (`ws`)**: High-throughput, bi-directional, persistent socket connections with low latency. *(Avoided heavy layers like Socket.io to keep binary payloads and JSON envelopes lean).*
- **TLS 1.3**: Encrypted transport for all peer-to-coordinator traffic.
- **Token-Based Handshake**: Cryptographic single-use join tokens with time-to-live (TTL).
- **HMAC / Ed25519 Message Signing**: Per-room cryptographic keypair so all message envelopes (`sig`) are verified against tampering.

### C. Validation & Serialization
- **Zod (v3.24+)**: Fail-fast runtime validation for every network envelope, contract lease, task status, and live diff frame. The single source of truth generating static TypeScript types via `z.infer`.
- **JSONL (JSON Lines)**: Append-only persistent event logging format for the room coordinator.

### D. Filesystem & Git Tooling
- **Node.js `fs/promises` & `path`**: Low-level, non-blocking file streaming.
- **Chokidar / Node Native `fs.watch`**: Event-driven filesystem observation to detect file changes and trigger live diff streams.
- **Git Worktrees (`git worktree add / remove`)**: Creation of isolated, disposable checkouts for the Critique Gate without polluting anyone's active branch or working tree.
- **Diff Parsing (`git diff --no-index`, unidiff)**: Generation of lightweight diff hunks streamed over the wire.

### E. AI Coding Agent Tooling Target
- **Anthropic Claude Code (`claude`)**
- **Google Antigravity (`agy`)**
- **Aider / Cursor / OpenCode**
*(The system is strictly CLI-agnostic because it interacts entirely via the filesystem).*

---

## 2. Distributed Systems Concepts & Theories

### A. Mutual Exclusion via Lease-Based Locks (Decentralized Coordination)
- **Concept**: Foundational contracts (`CONTRACT/schema.prisma`, `api.md`) cannot be concurrently modified by two lanes without race conditions.
- **Implementation**: Instead of permanent locks (which cause deadlocks if a developer's machine crashes), Nucleus uses **heartbeat-renewed lease mutexes (15s TTL)**. If a node disconnects, its locks expire automatically and safely without human deadlock resolution.

### B. Event Sourcing & Crash Recovery (Log-Structured State)
- **Concept**: The room coordinator maintains state in-memory backed by an **append-only JSONL log**.
- **Implementation**: Every lease acquired, task claimed, contract version bumped, and critique recorded is an immutable event. If the Initiator’s machine restarts, the coordinator replays the JSONL log to reconstruct the exact room state instantly.

### C. Pessimistic Locking vs. Optimistic Lane Isolation (Two-Tier Sync)
- **Tier 1 (Contracts):** Pessimistic concurrency control (explicit lease lock required before edit).
- **Tier 2 (Feature Code):** Optimistic concurrency control (developers build on isolated per-lane Git branches with zero file collisions).

### D. Single-Writer Principle per File (Strict Domain Ownership)
- Only one contributor owns a given lane and its corresponding source files.
- The only shared surfaces are the contracts in `CONTRACT/`, strictly governed by the lease table.

---

## 3. Computer Science & Software Engineering Patterns

### A. The "Pull Model" (Passive Synchronization Pattern)
- **Concept**: The central system never acts as an active driver/controller over participant terminals.
- **Reasoning**: To prevent anti-bot/ToS telemetry flags from LLM providers, Nucleus is purely a **reactive filesystem coordinator**. The human and their local CLI pull context from disk and push Git commits voluntarily.

### B. Shadow Workspace Mirroring (Cache Invalidation & Partial Replication)
- **Concept**: A developer in Lane A (Backend) needs to inspect code in Lane B (Frontend) in real time without waiting for Git remotes.
- **Implementation**: `sphere-node` creates a local read-only mirror at `.nucleus/shadows/<lane>/`. When Lane B saves a file, a delta packet updates the local shadow directory so both the developer and their local LLM agent can read it locally.

### C. File-Driven Context Injection (`.nucleus/PEERS.md`)
- **Concept**: Bridging the gap between distributed network sockets and LLM tool calling.
- **Implementation**: LLMs cannot query arbitrary WebSocket ports, but they inspect repository context files. Nucleus maintains a real-time markdown directory (`.nucleus/PEERS.md`) that gives the LLM immediate awareness of what peer files exist and where to inspect them.

### D. Self-Healing Critique Loop (Automated Feedback Gate)
- **Concept**: A two-stage pipeline separating deterministic compute from generative AI:
  1. *Deterministic Gate (Zero AI Cost):* Linting, TypeScript compiler checks, security scans (`gitleaks`), unit tests.
  2. *AI Critic Gate (High-Reasoning LLM):* Architectural alignment, contract conformity, and security boundaries.
- **Output**: A structured markdown file (`.nucleus/critiques/<task>.md`) that the builder agent reads to repair its own diff iteratively.

---

## 4. Security & Compliance Architecture

### A. Credential Immobility (Zero-Trust Principle)
- **Rule**: API keys, OAuth tokens, and session credentials never leave the developer's laptop.
- The coordinator only shuttles file diffs, contracts, task states, and review markdown files.

### B. Filesystem Jail (Path Traversal Defense)
- **Defense**: All paths received over the network are normalized via `path.resolve()` and tested against `workspace.startsWith(root)`.
- Rejects any symlinks, `../`, or absolute paths attempting to access personal directories, SSH keys, or environment files.

### C. The Human Merge Sovereign Rule
- No automated pipeline or critic agent can execute `git merge` into the `main` branch.
- The Critique Gate only outputs `approved` or `changes_requested`. A human Initiator must explicitly click or trigger the final merge.

---

## 5. Summary Matrix

| Domain | What Nucleus Uses |
| :--- | :--- |
| **Monorepo Architecture** | npm workspaces, TypeScript 5.7 (ESM/NodeNext) |
| **Data Contracts** | Zod v3.24 schemas (`@nucleus/protocol`) |
| **Networking** | TLS 1.3, Raw WebSockets (`ws`), JSONL Event Logging |
| **Concurrency Control** | 15s Lease Mutex (Contracts) + Isolated Branches (Features) |
| **Code Inspection** | Live Diff Streaming + Cross-Lane Shadow Mirrors (`.nucleus/shadows/`) |
| **Agent Discovery** | `.nucleus/PEERS.md` context injection |
| **Merge Safety** | Git Worktrees + Deterministic Checks + AI Critic Markdown loop |
| **Security Boundaries** | Workspace Jail, Credential Immobility, Human Merge Rule |
