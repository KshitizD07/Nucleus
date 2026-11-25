import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  HelloPayloadSchema,
  HeartbeatPayloadSchema,
  MessageEnvelopeSchema,
  ContractLockRequestSchema,
  ContractLockReleaseSchema,
  ContractUpdateRequestSchema,
  TaskClaimSchema,
  TaskStatusUpdateSchema,
  type TaskItem
} from "@nucleus/protocol";
import { AICriticPipeline, AutoLLMCriticProvider } from "@nucleus/critic";
import { NodeRegistry } from "../state/node-registry.js";
import { LeaseMutex } from "../lock/mutex.js";
import { EventLog } from "../state/event-log.js";
import { InviteStore } from "../state/invite-store.js";
import { ContractStore } from "../state/contract-store.js";
import { TaskBoardManager } from "../task/task-board.js";
import { buildMessage } from "./message-builder.js";

export interface CoordinatorOptions {
  port: number;
  roomId: string;
  logDir: string;
  contractDir?: string;
  taskDir?: string;
  maxClients?: number;
  maxPayloadBytes?: number;
  rateLimitMsgsPerSec?: number;
  maxFileSizeBytes?: number;
}

export class CoordinatorServer {
  private readonly wss: WebSocketServer;
  private readonly registry: NodeRegistry;
  private readonly mutex: LeaseMutex;
  private readonly eventLog: EventLog;
  private readonly invites: InviteStore;
  private readonly contractStore: ContractStore;
  private readonly taskBoard: TaskBoardManager;
  private readonly sockets: Map<string, WebSocket>;
  private readonly roomId: string;
  private readonly criticPipeline: AICriticPipeline;
  private readonly maxClients: number;
  private readonly maxPayloadBytes: number;
  private readonly rateLimitMsgsPerSec: number;
  private readonly maxFileSizeBytes: number;
  private readonly messageRateMap: Map<string, { windowStart: number; count: number }>;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: CoordinatorOptions) {
    this.roomId = options.roomId;
    this.registry = new NodeRegistry();
    this.mutex = new LeaseMutex();
    this.eventLog = new EventLog(options.logDir, options.roomId);
    this.invites = new InviteStore();
    this.contractStore = new ContractStore(options.contractDir ?? "./CONTRACT");
    this.taskBoard = new TaskBoardManager(options.taskDir ?? options.logDir);
    this.criticPipeline = new AICriticPipeline(new AutoLLMCriticProvider());
    this.sockets = new Map();
    this.maxClients = options.maxClients ?? 32;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 5 * 1024 * 1024; // 5 MB
    this.rateLimitMsgsPerSec = options.rateLimitMsgsPerSec ?? 300;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 2 * 1024 * 1024; // 2 MB
    this.messageRateMap = new Map();
    this.wss = new WebSocketServer({
      port: options.port,
      maxPayload: this.maxPayloadBytes
    });
  }

  public issueInvite(lane: string): string {
    return this.invites.issue(lane);
  }

  public getTaskBoard(): TaskBoardManager {
    return this.taskBoard;
  }

  public getContractStore(): ContractStore {
    return this.contractStore;
  }

  public getMutex(): LeaseMutex {
    return this.mutex;
  }

  public start(): void {
    this.wss.on("connection", (ws) => this.handleConnection(ws));
    this.heartbeatTimer = setInterval(() => this.evictStaleNodes(), 10_000);
    console.log(`[Coordinator] Room ${this.roomId} listening on port ${(this.wss.options as { port: number }).port}`);
  }

  public stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.wss.close();
  }

  private handleConnection(ws: WebSocket): void {
    ws.once("message", (raw) => {
      try {
        const envelope = MessageEnvelopeSchema.parse(JSON.parse(raw.toString()));

        if (envelope.type !== "session:hello") {
          ws.close(4001, "First message must be session:hello");
          return;
        }

        const hello = HelloPayloadSchema.parse(envelope.payload);
        const invite = this.invites.consume(hello.join_token, hello.node_id);

        if (!invite) {
          ws.close(4003, "Invalid or expired join token");
          return;
        }

        // Enforce invite lane authentication (Issue 3 fix)
        if (hello.lane && hello.lane !== invite.lane) {
          ws.close(4003, `Lane mismatch: Invite token issued for lane '${invite.lane}', but client requested '${hello.lane}'`);
          return;
        }

        const authoritativeLane = invite.lane;

        const node_id = hello.node_id;

        // Quota check: max concurrent clients per room (Issue 10 fix)
        if (this.sockets.size >= this.maxClients && !this.sockets.has(node_id)) {
          ws.close(4029, "Room capacity full");
          return;
        }

        const existingWs = this.sockets.get(node_id);
        if (existingWs && existingWs !== ws) {
          try {
            existingWs.removeAllListeners();
            existingWs.close(1000, "superseded_by_reconnect");
          } catch {}
        }
        this.sockets.set(node_id, ws);

        const existingNode = this.registry.get(node_id);
        if (!existingNode) {
          this.registry.register({
            node_id,
            lane: authoritativeLane,
            status: "idle",
            task_id: null,
            contract_version: 0,
            active_file: null
          });
          this.eventLog.append("node_joined", { node_id, lane: authoritativeLane });
        } else {
          this.registry.updateHeartbeat(node_id, { status: "idle" });
        }

        const contracts = this.contractStore.getAll().map((c) => ({
          file_path: c.filePath,
          version: c.version,
          content: c.content,
          touched_sections: []
        }));

        const tasks = this.taskBoard.getAll();

        const snapshot = buildMessage(this.roomId, "coordinator", "session:room_snapshot", {
          room_id: this.roomId,
          initiator_id: "coordinator",
          peers: this.registry.getAll().map((n) => ({
            node_id: n.node_id,
            lane: n.lane,
            status: n.status
          })),
          contract_version: contracts[0]?.version ?? 0,
          task_count: tasks.length,
          tasks,
          contracts
        });

        ws.send(JSON.stringify(snapshot));

        if (!existingNode) {
          this.broadcast(
            buildMessage(this.roomId, "coordinator", "session:peer_joined", {
              node_id,
              lane: authoritativeLane
            }),
            node_id
          );
        }

        ws.on("message", (data) => this.handleMessage(node_id, ws, data.toString()));
        ws.on("close", () => this.handleDisconnect(node_id));

        console.log(`[Coordinator] Node ${existingNode ? "reconnected" : "joined"}: ${node_id} (lane: ${authoritativeLane})`);
      } catch (err) {
        ws.close(4000, "Invalid handshake");
      }
    });
  }

  private handleMessage(node_id: string, ws: WebSocket, raw: string): void {
    try {
      // Per-socket sliding window rate limiting (Issue 10 fix)
      const now = Date.now();
      let rate = this.messageRateMap.get(node_id);
      if (!rate || now - rate.windowStart >= 1000) {
        rate = { windowStart: now, count: 1 };
        this.messageRateMap.set(node_id, rate);
      } else {
        rate.count++;
        if (rate.count > this.rateLimitMsgsPerSec) {
          console.warn(`[Coordinator] Rate limit exceeded for node ${node_id} (${rate.count} msgs/sec > ${this.rateLimitMsgsPerSec}). Dropping message.`);
          return;
        }
      }

      const envelope = MessageEnvelopeSchema.parse(JSON.parse(raw));

      if (envelope.type === "session:heartbeat") {
        const hb = HeartbeatPayloadSchema.parse(envelope.payload);
        this.registry.updateHeartbeat(node_id, {
          status: hb.status,
          task_id: hb.task_id,
          contract_version: hb.contract_version,
          active_file: hb.active_file
        });
        return;
      }

      if (envelope.type === "contract:lock_req") {
        this.handleContractLockRequest(node_id, ws, envelope.payload);
        return;
      }

      if (envelope.type === "contract:lock_release") {
        this.handleContractLockRelease(node_id, envelope.payload);
        return;
      }

      if (envelope.type === "contract:update") {
        this.handleContractUpdate(node_id, envelope.payload);
        return;
      }

      if (envelope.type === "task:claim") {
        this.handleTaskClaim(node_id, ws, envelope.payload);
        return;
      }

      if (envelope.type === "task:status") {
        this.handleTaskStatusUpdate(node_id, envelope.payload);
        return;
      }

      if (envelope.type === "sharing:file_focus_change") {
        const focus = envelope.payload as { lane: string; file_path: string; action: "editing" | "idle" | "saved" };
        const registered = this.registry.get(node_id);
        const authoritativeLane = registered?.lane ?? focus.lane;

        this.registry.updateHeartbeat(node_id, {
          active_file: focus.action === "idle" ? null : focus.file_path,
          status: focus.action === "editing" ? "active" : "idle"
        });

        // Authoritatively reconstruct envelope
        this.broadcast(
          buildMessage(this.roomId, node_id, "sharing:file_focus_change", {
            ...focus,
            lane: authoritativeLane
          }),
          node_id
        );
        return;
      }

      if (envelope.type === "sharing:lane_shadow_sync") {
        const node = this.registry.get(node_id);
        const authoritativeLane = node?.lane ?? (envelope.payload as any)?.source_lane;

        try {
          const sync = envelope.payload as { source_lane: string; file_path: string; content: string; version: number };
          if (sync.content && sync.content.length > this.maxFileSizeBytes) {
            console.warn(`[Coordinator] Dropped oversized shadow sync (${sync.content.length} bytes > ${this.maxFileSizeBytes}) from ${node_id}`);
            return;
          }

          const taskStorageDir = path.dirname(this.taskBoard.getStoragePath());
          const shadowLaneDir = path.resolve(taskStorageDir, "shadows", authoritativeLane);
          const shadowFile = path.resolve(shadowLaneDir, sync.file_path);

          // Path containment check on incoming shadow files
          const rel = path.relative(shadowLaneDir, shadowFile);
          const laneWithSep = shadowLaneDir.endsWith(path.sep) ? shadowLaneDir : shadowLaneDir + path.sep;
          if (rel.startsWith("..") || path.isAbsolute(rel) || (!shadowFile.startsWith(laneWithSep) && shadowFile !== shadowLaneDir)) {
            return; // Reject traversal attempt
          }

          fs.mkdirSync(path.dirname(shadowFile), { recursive: true });
          const tmpFile = path.join(
            path.dirname(shadowFile),
            `.${path.basename(shadowFile)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
          );
          fs.writeFileSync(tmpFile, sync.content, "utf8");
          fs.renameSync(tmpFile, shadowFile);
        } catch {
          // Ignore transient write errors
        }

        // Authoritatively reconstruct outgoing shadow sync message
        const syncPayload = envelope.payload as { source_lane: string; file_path: string; content: string; version: number };
        this.broadcast(
          buildMessage(this.roomId, node_id, "sharing:lane_shadow_sync", {
            ...syncPayload,
            source_lane: authoritativeLane
          }),
          node_id
        );
        return;
      }

      if (envelope.type === "sharing:live_diff_stream") {
        const node = this.registry.get(node_id);
        const diffPayload = envelope.payload as any;
        const authoritativeLane = node?.lane ?? diffPayload?.lane;

        // Authoritatively reconstruct live diff stream message
        this.broadcast(
          buildMessage(this.roomId, node_id, "sharing:live_diff_stream", {
            ...diffPayload,
            lane: authoritativeLane
          }),
          node_id
        );
        return;
      }

      // Drop any unrecognized or unauthorized message type (Issues 8 & 9 fix)
      console.warn(`[Coordinator] Dropped unauthorized/unknown client message type from ${node_id}: ${envelope.type}`);
    } catch {
      // Silently drop malformed messages
    }
  }

  private handleContractLockRequest(node_id: string, ws: WebSocket, payload: unknown): void {
    const req = ContractLockRequestSchema.parse(payload);

    if (!this.contractStore.isValidPath(req.file_path)) {
      ws.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "contract:lock_denied", {
        file_path: req.file_path,
        held_by: "system:invalid_path",
        expires_at: 0
      })));
      return;
    }

    const granted = this.mutex.acquire(req.file_path, node_id, req.ttl_seconds);

    if (granted) {
      this.eventLog.append("contract_lock_acquired", { file_path: req.file_path, holder: node_id });
      ws.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "contract:lock_grant", {
        file_path: req.file_path,
        holder_id: node_id,
        lease_expires_at: Date.now() + req.ttl_seconds * 1000
      })));
    } else {
      const existing = this.mutex.getLock(req.file_path);
      ws.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "contract:lock_denied", {
        file_path: req.file_path,
        held_by: existing?.holderId ?? "unknown",
        expires_at: existing?.expiresAt ?? 0
      })));
    }
  }

  private handleContractLockRelease(node_id: string, payload: unknown): void {
    const req = ContractLockReleaseSchema.parse(payload);
    if (!this.contractStore.isValidPath(req.file_path)) return;

    this.mutex.release(req.file_path, node_id);
    this.eventLog.append("contract_lock_released", { file_path: req.file_path, holder: node_id });
  }

  private handleContractUpdate(node_id: string, payload: unknown): void {
    const update = ContractUpdateRequestSchema.parse(payload);
    if (!this.contractStore.isValidPath(update.file_path)) return;
    if (update.content && update.content.length > this.maxFileSizeBytes) {
      console.warn(`[Coordinator] Dropped oversized contract update (${update.content.length} bytes > ${this.maxFileSizeBytes}) from ${node_id}`);
      return;
    }

    // Only the lock holder may publish an update
    const lock = this.mutex.getLock(update.file_path);
    if (!lock || lock.holderId !== node_id) return;

    const entry = this.contractStore.update(update.file_path, update.content);
    this.eventLog.append("contract_updated", { file_path: update.file_path, version: entry.version });

    this.broadcast(
      buildMessage(this.roomId, "coordinator", "contract:update", {
        file_path: update.file_path,
        version: entry.version,
        content: update.content,
        touched_sections: update.touched_sections
      }),
      node_id
    );
  }

  private handleTaskClaim(node_id: string, ws: WebSocket, payload: unknown): void {
    const claim = TaskClaimSchema.parse(payload);
    const node = this.registry.get(node_id);
    const result = this.taskBoard.claimTask(claim.task_id, node_id, undefined, node?.lane, claim.display_name);

    if (result.success && result.task) {
      this.eventLog.append("task_claimed", { task_id: claim.task_id, node_id });
      this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", result.task));
    } else {
      const targetLane = node?.lane;
      const availableTasks = targetLane
        ? this.taskBoard
            .getByLane(targetLane)
            .filter((t) => !t.assigned_to || t.status === "unassigned")
            .map((t) => t.id)
        : [];

      ws.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:claim_failed", {
        task_id: claim.task_id,
        reason: result.reason,
        available_tasks: availableTasks
      })));
    }
  }

  private handleTaskStatusUpdate(node_id: string, payload: unknown): void {
    const update = TaskStatusUpdateSchema.parse(payload);
    const node = this.registry.get(node_id);
    const task = this.taskBoard.getTask(update.task_id);

    if (!task) {
      const ws = this.sockets.get(node_id);
      ws?.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:update_failed", {
        task_id: update.task_id,
        reason: `Task '${update.task_id}' not found`
      })));
      return;
    }

    const callerLane = node?.lane;
    const isInitiatorOrJudge = callerLane === "initiator" || callerLane === "judge";

    // 1. Self-approval prohibition: regular contributors cannot directly approve or reject tasks
    if ((update.status === "approved" || update.status === "changes_requested") && !isInitiatorOrJudge) {
      const ws = this.sockets.get(node_id);
      ws?.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:update_failed", {
        task_id: update.task_id,
        reason: `Forbidden: Node '${node_id}' in lane '${callerLane}' cannot directly set status to '${update.status}'. Reviews must be processed by Critique Gate.`
      })));
      return;
    }

    // 2. Lane verification: contributor can only update tasks belonging to their lane
    if (!isInitiatorOrJudge && callerLane && task.lane !== callerLane) {
      const ws = this.sockets.get(node_id);
      ws?.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:update_failed", {
        task_id: update.task_id,
        reason: `Forbidden: Lane mismatch. Node '${node_id}' in lane '${callerLane}' cannot update task '${task.id}' in lane '${task.lane}'`
      })));
      return;
    }

    // 3. Ownership verification: task assigned to another node cannot be modified by peers
    const isOwner = task.assigned_to === node_id || (task.assigned_to && task.assigned_to.includes(node_id));
    if (!isInitiatorOrJudge && task.assigned_to && !isOwner) {
      const ws = this.sockets.get(node_id);
      ws?.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:update_failed", {
        task_id: update.task_id,
        reason: `Forbidden: Task '${task.id}' is assigned to '${task.assigned_to}', not '${node_id}'`
      })));
      return;
    }

    // 4. In_review transition requires the task to be claimed first
    if (update.status === "in_review" && !task.assigned_to) {
      const ws = this.sockets.get(node_id);
      ws?.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:update_failed", {
        task_id: update.task_id,
        reason: `Forbidden: Unassigned task '${task.id}' cannot be submitted for review before being claimed`
      })));
      return;
    }

    const result = this.taskBoard.updateStatus(update.task_id, update.status, update.branch);

    if (result.success && result.task) {
      this.eventLog.append("task_status_changed", { task_id: update.task_id, status: update.status, node_id });
      this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", result.task));

      if (result.unblockedTasks) {
        for (const t of result.unblockedTasks) {
          this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", t));
        }
      }
      if (result.spawnedTasks) {
        for (const t of result.spawnedTasks) {
          this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", t));
        }
      }

      if (update.status === "in_review") {
        this.runAutomatedCritique(result.task, node_id);
      }
    }
  }

  private async runAutomatedCritique(task: TaskItem, nodeId: string): Promise<void> {
    console.log(`\n[Critique Gate] 🔍 Auto-review triggered for Task [${task.id}] (${task.lane})...`);

    const contractContext = this.contractStore.getAll().map((c) => `# ${c.filePath}\n${c.content}`).join("\n\n");
    let diffContext = "";
    const taskStorageDir = path.dirname(this.taskBoard.getStoragePath());
    const shadowLaneDir = path.join(taskStorageDir, "shadows", task.lane);

    if (fs.existsSync(shadowLaneDir)) {
      const walkFiles = (dir: string): string[] => {
        const found: string[] = [];
        for (const item of fs.readdirSync(dir)) {
          const p = path.join(dir, item);
          if (fs.statSync(p).isDirectory()) {
            found.push(...walkFiles(p));
          } else {
            found.push(p);
          }
        }
        return found;
      };

      const files = walkFiles(shadowLaneDir);
      diffContext = files
        .map((f) => `// File: ${path.relative(shadowLaneDir, f)}\n${fs.readFileSync(f, "utf8")}`)
        .join("\n\n");
    }

    try {
      const { result, markdown } = await this.criticPipeline.evaluate({
        taskId: task.id,
        lane: task.lane,
        spec: `${task.title}\n\nAgreed Contracts:\n${contractContext}`,
        diff: diffContext || "(Implementation files submitted for review)",
        deterministicChecksPassed: true
      });

      const critiquesDir = path.join(taskStorageDir, "critiques");
      fs.mkdirSync(critiquesDir, { recursive: true });
      fs.writeFileSync(path.join(critiquesDir, `${task.id}.md`), markdown, "utf8");

      const newStatus = result.verdict === "approved" ? "approved" : "changes_requested";
      const updated = this.taskBoard.updateStatus(task.id, newStatus);

      if (updated.success && updated.task) {
        this.eventLog.append("task_status_changed", { task_id: task.id, status: newStatus, node_id: "critique-gate" });
        this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", updated.task));

        if (updated.unblockedTasks) {
          for (const t of updated.unblockedTasks) {
            this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", t));
          }
        }
        if (updated.spawnedTasks) {
          for (const t of updated.spawnedTasks) {
            this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", t));
          }
        }
      }

      if (result.verdict === "approved") {
        console.log(`[Critique Gate] ✅ Task [${task.id}] APPROVED! Report written to .nucleus/critiques/${task.id}.md`);
        console.log(`[Critique Gate] 🎉 Contributor ${task.assigned_to || nodeId} may now git push to GitHub.\n`);
      } else {
        console.log(`[Critique Gate] ⚠️ Task [${task.id}] CHANGES_REQUESTED. Report written to .nucleus/critiques/${task.id}.md\n`);
      }
    } catch (err: any) {
      console.error(`[Critique Gate] Automated review failed: ${err.message}`);
    }
  }

  private handleDisconnect(node_id: string): void {
    this.messageRateMap.delete(node_id);
    this.registry.remove(node_id);
    this.sockets.delete(node_id);
    this.eventLog.append("node_severed", { node_id, reason: "disconnect" });

    this.broadcast(
      buildMessage(this.roomId, "coordinator", "session:severed", {
        node_id,
        reason: "user_exit"
      }),
      node_id
    );

    console.log(`[Coordinator] Node disconnected: ${node_id}`);
  }

  private evictStaleNodes(): void {
    const evicted = this.registry.evictStale(20_000);
    for (const node_id of evicted) {
      this.messageRateMap.delete(node_id);
      const ws = this.sockets.get(node_id);
      if (ws) {
        ws.terminate();
        this.sockets.delete(node_id);
      }
      this.eventLog.append("node_severed", { node_id, reason: "timeout" });
      console.log(`[Coordinator] Evicted stale node: ${node_id}`);
    }
  }

  public broadcast(message: unknown, excludeNodeId?: string): void {
    const data = JSON.stringify(message);
    for (const [id, ws] of this.sockets) {
      if (id !== excludeNodeId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}
