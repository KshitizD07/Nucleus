# Nucleus — AI Agent Engineering Instructions & System Guidelines

> **IMPORTANT FOR ALL AI CODING AGENTS (Claude Code, Google Antigravity, Cursor, Aider):**
> You are operating within the **Nucleus** repository. Follow these non-negotiable architectural invariants, protocols, and workflows at all times.

---

## 1. Non-Negotiable Architectural Rules

1. **The Pure Pull Model (ZERO Central Terminal Control):**
   - NEVER implement or introduce mechanisms that spawn, hijack, wrap, or inject prompts/keystrokes into a contributor's AI CLI or terminal session.
   - The central coordinator only synchronizes repository files: `CONTRACT/`, `.nucleus/tasks.json`, `.nucleus/shadows/`, and `.nucleus/critiques/*.md`.
   - Contributors drive their own official CLI locally.

2. **Credential Immobility:**
   - NEVER transport API keys, OAuth tokens, session cookies, or user credentials over the network.
   - The network protocol only passes task metadata, diff hunks, contract files, and critique feedback.

3. **Workspace Isolation & Jail:**
   - Every file operation in `@nucleus/daemon` MUST resolve against the bound workspace root using `WorkspaceJail` (`path.resolve` check).
   - Reject any path traversal attempts (`..`, symlinks pointing outside the workspace).

4. **Single Source of Truth for Types:**
   - Every network payload and event MUST be defined as a Zod schema in `packages/protocol/src/`.
   - Never define ad-hoc wire types in `daemon` or `coordinator`. Import them from `@nucleus/protocol`.

---

## 2. Monorepo Package Boundaries

- **`packages/protocol`**: Pure wire contracts, Zod schemas, and TypeScript interfaces. Zero dependencies on other packages.
- **`packages/daemon`**: Contributor's local `sphere-node` companion. Responsible for workspace jail, contract replication, live diff streaming, and `.nucleus/PEERS.md` maintenance.
- **`packages/coordinator`**: Room server (`sphere-coordinator`). Manages 15s lease mutex locks, JSONL event logs, and diff feed fanout.
- **`packages/critic`**: Review runner. Executes deterministic tests in disposable Git worktrees and formats AI critique markdown files.

---

## 3. Git Commit Convention

All commit messages MUST strictly follow the lowercase action-prefixed standard:
- `create:` New files, modules, test suites, or Zod schemas (e.g., `create: websocket connection manager`)
- `add:` Helper utilities, functions, or documentation (e.g., `add: lease renewal heartbeat timer`)
- `update:` Modifications to existing logic, configs, or logs (e.g., `update: contract lock timeout to 15s`)
- `resolve:` Bug fixes or error handling (e.g., `resolve: unhandled socket disconnect in coordinator`)

---

## 4. Daily Session Logging Protocol

Whenever introducing a major change (new subsystem, protocol message, state machine update, or architectural decision), you MUST create a log file under:
`logs/<domain>/<feature>/<task_name>_<YYYY-MM-DD>.txt` following the 8-section layout specified in [logs/instruction.txt](logs/instruction.txt).

---

## 5. Development Commands

- Build all packages: `npm run build`
- Run test suites: `npm test`
- Build specific package: `npm run build --workspace=@nucleus/protocol`
