# Nucleus Live Dogfooding — Feedback, Bugs & Observations
**Session Date:** 2026-11-24  
**Setup:** Multi-Node, Internet Cloudflare Tunnel, Cross-Machine (Initiator/Host + Backend + Frontend Lanes)

This document tracks all bugs, UX quirks, edge cases, and unexpected behaviors observed during live dogfooding with team contributors. All items here will be resolved and verified once the functional walkthrough is complete.

---

## 📋 Open Issues & Bugs to Resolve

### ✅ Bug 1: Task Board Displays Ephemeral `node_id` Instead of Human Name [RESOLVED]
- **Observed Behavior:** When a task is claimed (`nucleus claim task-backend-01`), the CLI output reports:  
  `✅ Successfully claimed task [task-backend-01] for [kshit]!`  
  However, running `nucleus tasks` displays:  
  `ASSIGNED: node-backend-yppys` instead of `kshit`.
- **Root Cause:** When `JoinRunner` / `DaemonClient` sends `task:claim`, it forwards `this.options.node_id` to the coordinator, which stored the internal socket node ID rather than the contributor's display handle/name (`options.name`).
- **Resolution:**
  - Added optional `display_name` to `TaskClaimSchema` in `@nucleus/protocol`.
  - Updated `TaskBoardManager.claimTask()` to record `displayName || nodeId`.
  - Updated `JoinRunner` to forward `name` from CLI flags (`--name`) or local `.nucleus/session.json` to `claimTask(taskId, displayName)`.
  - Verified with 100% passing test suite across all 19 test files.

---

## 📝 Observations & Notes Log
- **Observation 1:** Cloudflare quick tunnel handshake requires ~6-8 seconds for DNS propagation. The timeout was bumped to 15s to ensure reliable public URLs.
- **Observation 2:** Tasks bidirectional synchronization successfully detected local disk edits and synchronized across remote machines.
- **Observation 3:** Cross-lane validation successfully stopped frontend node from claiming backend tasks.
