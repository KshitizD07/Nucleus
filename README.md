# ⚛️ Nucleus — Multiplayer AI Engineering Room

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.4-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)](LICENSE)
[![Architecture](https://img.shields.io/badge/architecture-P2P%20Pull%20Model-purple.svg)](docs/multiplayer-room-architecture.md)

> **Turn AI-assisted coding from a single-player silo into a live, collaborative, multi-terminal engineering room.**

**Nucleus** enables an Initiator (Tech Lead / Architect) and Contributors (Specialist Builders) to collaborate simultaneously across isolated code lanes against a shared, locked living contract. Each engineer drives their own official AI coding CLI (Claude Code, Antigravity, Aider) under their own subscription, while Nucleus provides real-time workspace diff streaming, contract synchronization, and automated critique verification.

---

## 📑 Table of Contents

- [The Core Problem](#-the-core-problem)
- [System Architecture (The Pull Model)](#-system-architecture-the-pull-model)
- [Core Capabilities & How Collaboration Works](#-core-capabilities--how-collaboration-works)
- [How LLM Agents Auto-Discover Peer Code (`.nucleus/PEERS.md`)](#-how-llm-agents-auto-discover-peer-code-nucleuspeersmd)
- [Non-Negotiable Safety & Compliance Boundaries](#-non-negotiable-safety--compliance-boundaries)
- [Project Directory Layout](#-project-directory-layout)
- [Component Breakdown](#-component-breakdown)
- [Message Protocol](#-message-protocol)
- [Logging & Engineering Protocols](#-logging--engineering-protocols)
- [MVP Roadmap](#-mvp-roadmap)

---

## ⚠️ The Core Problem

AI coding agents have revolutionized software authoring, but working with them in isolation hits four hard walls:

1. **Context Rot**: When a single AI session holds an entire full-stack app (schema, APIs, frontend, tests), reasoning degrades and cross-file hallucinations skyrocket.
2. **Quota Ceilings**: Free and mid-tier AI developer accounts hit 5-hour rolling and weekly rate limits. Running multiple parallel agents on one account burns quota rapidly.
3. **The Solo Review Bottleneck**: One developer running several agents on a laptop is forced to review multiple complex diffs alone.
4. **Integration Debt**: Separated developers using AI generate divergent schemas and API signatures, leading to painful merge friction.

Nucleus solves this by turning software engineering into a **structured, live multiplayer room**.

---

## 🏗️ System Architecture (The Pull Model)

```
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
```

### The "Zero Central Control" Design Rule
Our software **never drives or injects commands into a contributor's logged-in AI CLI**. External processes driving subscription CLIs violate automated abuse telemetry (Anthropic, Google). 

Instead, Nucleus uses an unprivileged **file-based pull model**:
- The room coordinates files: `CONTRACT/`, `TASKS.json`, and `.nucleus/critiques/*.md`.
- Each engineer opens their own official, logged-in CLI terminal locally.
- The critique output is simply a structured review file that the builder's local agent ingests.

---

## ⚡ Core Capabilities & How Collaboration Works

Dropping central terminal steering does **not** mean working in silos. Nucleus delivers true live collaboration:

1. **Live Work-in-Progress Diff Streaming**: As an agent or human writes code, `sphere-node` streams file-touch events and incremental diffs to the room feed. Everyone sees schemas, types, and logic take shape in real time.
2. **Cross-Lane Shadow Mirror (`.nucleus/shadows/<lane>/`)**: When a backend engineer needs to inspect how the frontend is calling an endpoint (or vice-versa), they don't wait for a git commit or push to GitHub. The daemon maintains a read-only local shadow directory of active peer lanes.
3. **The Living Contract (`CONTRACT/`)**: Foundational files (DB schema, OpenAPI endpoints, Socket events) require a short lease-based lock to modify. Once updated, changes are broadcast instantly to all dependent lanes.
4. **The Critique Gate**: When a task is marked `in_review`:
   - Stage 1: Deterministic checks (lint, types, tests, secret-scan) run in a clean Git worktree.
   - Stage 2: Initiator AI critic reviews the diff against the original spec and writes structured findings to `.nucleus/critiques/<task-id>.md`.
   - The contributor tells their local CLI: `claude "Address issues in .nucleus/critiques/auth.md"`.
5. **Git Stays the Source of Truth**: The room never has write access to the central repository. The engineer who wrote the code reviews the final diff and pushes their own Git commit.

---

## 🤖 How LLM Agents Auto-Discover Peer Code (`.nucleus/PEERS.md`)

AI coding agents (Claude Code, Google Antigravity, Cursor, Aider) do not have telepathic knowledge of network websockets, but they natively read workspace files. 

Nucleus bridges this gap using an automatically maintained **`.nucleus/PEERS.md`** file:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HOW THE AGENT "KNOWS"                           │
├────────────────────────────────────────────────────────────────────────┤
│ 1. `sphere-node` automatically creates and updates `.nucleus/PEERS.md` │
│    in real time as teammates work.                                     │
│                                                                        │
│ 2. The agent reads `.nucleus/PEERS.md` and discovers:                  │
│    "Aryan is currently editing backend auth at:                        │
│     .nucleus/shadows/backend/src/modules/auth/auth.controller.ts"      │
│                                                                        │
│ 3. When prompted to "build the frontend login form", the agent         │
│    proactively reads that shadow file, extracts the exact body types   │
│    and response envelope, and implements matching UI hooks!            │
└────────────────────────────────────────────────────────────────────────┘
```

This guarantees that:
- **Zero Hallucinated APIs**: The frontend agent writes hooks matching the actual backend controller, not an assumed interface.
- **Zero Git Friction**: The backend code does not need to be committed or pushed to a remote GitHub branch for the frontend agent to inspect it.

---

## 🛡️ Non-Negotiable Safety & Compliance Boundaries

- **Zero Credential Mobility**: No API keys, session tokens, or OAuth secrets ever touch the wire.
- **Workspace Jail**: The daemon resolves paths against the repo root; traversal attempts (`..`, symlinks) trigger an instant error.
- **Invite-Only Squad Rooms**: Phase 1 is restricted to private, trusted squads (no public stranger lobbies).
- **Human Merge Rule**: No automated bot path to `main`. The human Initiator explicitly makes the final merge decision.

---

## 📁 Project Directory Layout

```
nucleus/
├── docs/                                          # Architecture specifications & analysis
│   ├── technical-and-conceptual-blueprint.md      # Tech stack, distributed systems theories & patterns
│   ├── multiplayer-room-architecture.md           # System architecture v2.0
│   ├── multiplayer-ai-engineering-analysis (1).md # Pre-build economic & risk analysis
│   └── Multiplayer AI Engineering Room.pdf        # Team project guide
├── logs/                                          # Standardized daily session audit trail
│   ├── instruction.txt                            # Session logging protocol & rules
│   └── docs/                                      # Logs categorized by domain & feature
│       └── architecture/
│           └── pull_model_refactor_2026-11-23.txt
├── packages/                                      # Monorepo packages (TypeScript)
│   ├── protocol/                                  # Zod message envelopes & wire contracts
│   ├── coordinator/                               # Room coordinator, lease mutex, taskboard
│   ├── daemon/                                    # sphere-node (workspace sync, diff stream, PEERS.md)
│   └── critic/                                    # Git worktree test & AI review runner
├── .nucleus/                                      # Local runtime coordination directory
│   ├── PEERS.md                                   # Real-time peer roster & active file index (read by agents)
│   ├── shadows/                                   # Live read-only mirrors of peer lane working trees
│   │   ├── backend/                               # Live uncommitted files from backend lane
│   │   └── frontend/                              # Live uncommitted files from frontend lane
│   └── critiques/                                 # Critic feedback markdown files for local agents
└── CONTRACT/                                      # The Living Blueprint (shared interfaces)
    ├── api.md                                     # REST/GraphQL route specifications
    ├── schema.prisma                              # Database contract
    ├── events.md                                  # Real-time event catalog
    └── tasks.json                                 # Task board state
```

---

## 📡 Message Protocol (Zod Envelopes)

All room traffic uses signed, Zod-validated JSON envelopes over TLS WebSockets:

```typescript
type MessageEnvelope<T> = {
  room_id: string;
  node_id: string;
  ts: number;
  type: string;
  payload: T;
  sig: string;
};
```

### Event Types
- `session:*` — `hello`, `room_snapshot`, `accept`, `severed`, `heartbeat`
- `contract:*` — `lock_req`, `lock_grant`, `lock_release`, `contract_update`
- `task:*` — `claim`, `assign`, `status`, `submit_review`, `approved`
- `sharing:*` — `live_diff_stream`, `file_focus_change`, `progress_milestone`
- `gate:*` — `check_result`, `critic_findings_file`

---

## 📝 Logging & Engineering Protocols

Nucleus follows the **Opendoor Engineering Protocol**:
- **Daily Session Logs**: Every architectural change or protocol shift is documented in `logs/<domain>/<feature>/<task>_<date>.txt` capturing *Objective*, *Architecture Details*, *Why Behind The Change*, and *Why Not The Alternatives*. See [logs/instruction.txt](logs/instruction.txt).
- **Commit Pattern**: Semantic action-prefixed commits:
  - `create:` New features, schemas, or test suites
  - `add:` Helper utilities, endpoints, or documentation
  - `update:` Modifying existing logic or logs
  - `resolve:` Bug fixes and error handling

---

## 🗺️ MVP Roadmap (Phases 1 & 2)

- [x] **Week 0:** Pre-build analysis, ToS risk evaluation, architecture v2.0 refactor (Pure Pull Model & Live Diffs).
- [x] **Milestone 1:** Zod protocol envelope, `sphere-node` companion daemon, room coordinator (join handshake, heartbeat management, JSONL replay log).
- [x] **Milestone 2:** Living Contract synchronization, lease-based mutex locks (15s TTL), and daemon contract replicas.
- [x] **Milestone 3:** Live WIP diff streaming, cross-lane shadow mirroring (`.nucleus/shadows/<lane>/`), and automatic `.nucleus/PEERS.md` context injection for AI agents.
- [x] **Milestone 4:** Task Board lifecycle state machine (`tasks.json`), disposable Git worktrees, deterministic check runners, and formatted markdown critique generation.
- [x] **Milestone 5:** Developer CLI package (`@nucleus/cli`) with executable `nucleus init` (room host) and `nucleus join` (contributor companion).
- [ ] **First Dogfood Session:** Multi-lane parallel build run on **Opendoor** (Hostel Management backend) with 2 nodes; measure speedup vs solo baseline.
- [ ] **Scale Run:** 3–4 nodes on **SkillSphere**; empirical publish of multi-agent parallelism limits.
