import { WebSocketServer, WebSocket } from "ws";
import {
  HelloPayloadSchema,
  HeartbeatPayloadSchema,
  MessageEnvelopeSchema
} from "@nucleus/protocol";
import { NodeRegistry } from "../state/node-registry.js";
import { LeaseMutex } from "../lock/mutex.js";
import { EventLog } from "../state/event-log.js";
import { InviteStore } from "../state/invite-store.js";
import { buildMessage } from "./message-builder.js";

export interface CoordinatorOptions {
  port: number;
  roomId: string;
  logDir: string;
}

export class CoordinatorServer {
  private readonly wss: WebSocketServer;
  private readonly registry: NodeRegistry;
  private readonly mutex: LeaseMutex;
  private readonly eventLog: EventLog;
  private readonly invites: InviteStore;
  private readonly sockets: Map<string, WebSocket>;
  private readonly roomId: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(options: CoordinatorOptions) {
    this.roomId = options.roomId;
    this.registry = new NodeRegistry();
    this.mutex = new LeaseMutex();
    this.eventLog = new EventLog(options.logDir, options.roomId);
    this.invites = new InviteStore();
    this.sockets = new Map();
    this.wss = new WebSocketServer({ port: options.port });
  }

  public issueInvite(lane: string): string {
    return this.invites.issue(lane);
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

        const snapshot = buildMessage(this.roomId, "coordinator", "session:room_snapshot", {
          room_id: this.roomId,
          initiator_id: "coordinator",
          peers: this.registry.getAll().map((n) => ({
            node_id: n.node_id,
            lane: n.lane,
            status: n.status
          })),
          contract_version: 0,
          task_count: 0
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

  private handleMessage(node_id: string, _ws: WebSocket, raw: string): void {
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

      // Fan out all other messages (diff streams, contract updates, etc.)
      this.broadcast(envelope, node_id);
    } catch {
      // Silently drop malformed messages
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

  private broadcast(message: unknown, excludeNodeId?: string): void {
    const data = JSON.stringify(message);
    for (const [id, ws] of this.sockets) {
      if (id !== excludeNodeId && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}
