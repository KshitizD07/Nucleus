import { WebSocketServer, WebSocket } from "ws";
import {
  HelloPayloadSchema,
  HeartbeatPayloadSchema,
  MessageEnvelopeSchema,
  ContractLockRequestSchema,
  ContractLockReleaseSchema,
  ContractUpdateRequestSchema,
  TaskClaimSchema,
  TaskStatusUpdateSchema
} from "@nucleus/protocol";
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
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: CoordinatorOptions) {
    this.roomId = options.roomId;
    this.registry = new NodeRegistry();
    this.mutex = new LeaseMutex();
    this.eventLog = new EventLog(options.logDir, options.roomId);
    this.invites = new InviteStore();
    this.contractStore = new ContractStore(options.contractDir ?? "./CONTRACT");
    this.taskBoard = new TaskBoardManager(options.taskDir ?? options.logDir);
    this.sockets = new Map();
    this.wss = new WebSocketServer({ port: options.port });
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
        const invite = this.invites.consume(hello.join_token);

        if (!invite) {
          ws.close(4003, "Invalid or expired join token");
          return;
        }

        const node_id = hello.node_id;
        this.sockets.set(node_id, ws);

        this.registry.register({
          node_id,
          lane: hello.lane,
          status: "idle",
          task_id: null,
          contract_version: 0,
          active_file: null
        });

        this.eventLog.append("node_joined", { node_id, lane: hello.lane });

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

        this.broadcast(
          buildMessage(this.roomId, "coordinator", "session:peer_joined", {
            node_id,
            lane: hello.lane
          }),
          node_id
        );

        ws.on("message", (data) => this.handleMessage(node_id, ws, data.toString()));
        ws.on("close", () => this.handleDisconnect(node_id));

        console.log(`[Coordinator] Node joined: ${node_id} (lane: ${hello.lane})`);
      } catch (err) {
        ws.close(4000, "Invalid handshake");
      }
    });
  }

  private handleMessage(node_id: string, ws: WebSocket, raw: string): void {
    try {
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
        this.registry.updateHeartbeat(node_id, {
          active_file: focus.action === "idle" ? null : focus.file_path,
          status: focus.action === "editing" ? "active" : "idle"
        });
        this.broadcast(envelope, node_id);
        return;
      }

      // Fan out all other messages (diff streams, task events, lane shadow syncs, etc.)
      this.broadcast(envelope, node_id);
    } catch {
      // Silently drop malformed messages
    }
  }

  private handleContractLockRequest(node_id: string, ws: WebSocket, payload: unknown): void {
    const req = ContractLockRequestSchema.parse(payload);
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
    this.mutex.release(req.file_path, node_id);
    this.eventLog.append("contract_lock_released", { file_path: req.file_path, holder: node_id });
  }

  private handleContractUpdate(node_id: string, payload: unknown): void {
    const update = ContractUpdateRequestSchema.parse(payload);

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
    const result = this.taskBoard.claimTask(claim.task_id, node_id);

    if (result.success && result.task) {
      this.eventLog.append("task_claimed", { task_id: claim.task_id, node_id });
      this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", result.task));
    } else {
      ws.send(JSON.stringify(buildMessage(this.roomId, "coordinator", "task:claim_failed", {
        task_id: claim.task_id,
        reason: result.reason
      })));
    }
  }

  private handleTaskStatusUpdate(node_id: string, payload: unknown): void {
    const update = TaskStatusUpdateSchema.parse(payload);
    const result = this.taskBoard.updateStatus(update.task_id, update.status, update.branch);

    if (result.success && result.task) {
      this.eventLog.append("task_status_changed", { task_id: update.task_id, status: update.status, node_id });
      this.broadcast(buildMessage(this.roomId, "coordinator", "task:status", result.task));
    }
  }

  private handleDisconnect(node_id: string): void {
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
