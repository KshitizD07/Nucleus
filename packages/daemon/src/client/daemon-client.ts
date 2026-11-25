import { WebSocket } from "ws";
import { MessageEnvelopeSchema } from "@nucleus/protocol";
import type { HelloPayload, HeartbeatPayload, RoomSnapshotPayload, TaskStatus } from "@nucleus/protocol";

export type DaemonStatus = "idle" | "active" | "review";

export interface DaemonClientOptions {
  url: string;
  node_id: string;
  join_token: string;
  workspace_path: string;
  lane: string;
  heartbeatIntervalMs?: number;
  autoReconnect?: boolean;
  baseReconnectIntervalMs?: number;
  maxReconnectIntervalMs?: number;
}

export class DaemonClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isSevered: boolean = false;
  private reconnectAttempts: number = 0;
  private status: DaemonStatus = "idle";
  private activeFile: string | null = null;
  private contractVersion: number = 0;
  private taskId: string | null = null;
  private readonly options: Required<DaemonClientOptions>;
  private connectResolve?: () => void;
  private connectReject?: (err: Error) => void;
  private outboundQueue: { type: string; payload: unknown }[] = [];
  private readonly maxQueueSize = 100;

  public onSnapshot?: (snapshot: RoomSnapshotPayload) => void;
  public onMessage?: (type: string, payload: unknown) => void;
  public onDisconnect?: (reason: string) => void;
  public onReconnect?: () => void;

  constructor(options: DaemonClientOptions) {
    this.options = {
      heartbeatIntervalMs: 2000,
      autoReconnect: true,
      baseReconnectIntervalMs: 1000,
      maxReconnectIntervalMs: 30_000,
      ...options
    };
  }

  public connect(): Promise<void> {
    this.isSevered = false;
    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.initiateConnection();
    });
  }

  private initiateConnection(): void {
    if (this.isSevered) return;

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.once("open", () => {
        this.reconnectAttempts = 0;
        this.sendHello();
        // Handshake completion awaits session:room_snapshot in handleMessage (Issue 18)
      });

      this.ws.on("error", (err) => {
        if (this.connectReject) {
          const reject = this.connectReject;
          this.connectResolve = undefined;
          this.connectReject = undefined;
          reject(err);
        } else {
          console.warn(`[Daemon] Socket error: ${err.message}`);
        }
      });

      this.ws.on("message", (raw) => this.handleMessage(raw.toString()));

      this.ws.on("close", (code, reason) => {
        this.stopHeartbeat();
        const msg = reason?.toString() ?? "unknown";
        console.log(`[Daemon] Disconnected: ${code} - ${msg}`);
        this.onDisconnect?.(msg);

        if (this.connectReject && (code === 4000 || code === 4003 || code === 4029)) {
          const reject = this.connectReject;
          this.connectResolve = undefined;
          this.connectReject = undefined;
          reject(new Error(`Connection failed with code ${code}: ${msg}`));
          return;
        }

        // If not intentional sever and autoReconnect is enabled, schedule retry
        if (!this.isSevered && this.options.autoReconnect && code !== 1000 && code !== 4003) {
          this.scheduleReconnect();
        }
      });
    } catch (err: any) {
      if (this.connectReject) {
        const reject = this.connectReject;
        this.connectResolve = undefined;
        this.connectReject = undefined;
        reject(err);
      } else {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.isSevered || this.reconnectTimer) return;

    this.reconnectAttempts++;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, up to maxReconnectIntervalMs (default 30s)
    const base = this.options.baseReconnectIntervalMs;
    const exp = base * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5));
    const jitter = Math.floor(Math.random() * (base > 100 ? 200 : 10));
    const delay = Math.min(exp + jitter, this.options.maxReconnectIntervalMs);

    console.log(`[Daemon] Connection lost. Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.initiateConnection();
    }, delay);
  }

  public sever(): void {
    this.isSevered = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.outboundQueue = [];
    this.connectResolve = undefined;
    this.connectReject = undefined;
    this.ws?.close(1000, "user_exit");
  }

  public requestContractLock(filePath: string, ttlSeconds: number = 15): void {
    this.send("contract:lock_req", { file_path: filePath, ttl_seconds: ttlSeconds });
  }

  public releaseContractLock(filePath: string): void {
    this.send("contract:lock_release", { file_path: filePath });
  }

  public publishContractUpdate(filePath: string, content: string, touchedSections: string[] = []): void {
    this.send("contract:update", {
      file_path: filePath,
      content,
      touched_sections: touchedSections
    });
  }

  public streamDiff(diff: { lane: string; active_file: string; files_changed: string[]; patch_summary: string; diff_hunk?: string }): void {
    this.send("sharing:live_diff_stream", diff);
  }

  public notifyFocusChange(filePath: string, action: "editing" | "idle" | "saved"): void {
    this.send("sharing:file_focus_change", {
      lane: this.options.lane,
      file_path: filePath,
      action
    });
  }

  public syncLaneShadow(sourceLane: string, filePath: string, content: string, version: number): void {
    this.send("sharing:lane_shadow_sync", {
      source_lane: sourceLane,
      file_path: filePath,
      content,
      version
    });
  }

  public deleteLaneShadow(sourceLane: string, filePath: string, version: number): void {
    this.send("sharing:lane_shadow_delete", {
      source_lane: sourceLane,
      file_path: filePath,
      version
    });
  }

  public claimTask(taskId: string, displayName?: string, expectedRevision?: number): void {
    this.send("task:claim", {
      task_id: taskId,
      node_id: this.options.node_id,
      display_name: displayName,
      expected_revision: expectedRevision
    });
  }

  public updateTaskStatus(taskId: string, status: TaskStatus, branch?: string, expectedRevision?: number): void {
    this.send("task:status", {
      task_id: taskId,
      status,
      branch,
      expected_revision: expectedRevision
    });
  }

  public setStatus(status: DaemonStatus, activeFile?: string | null, taskId?: string | null): void {
    this.status = status;
    if (activeFile !== undefined) this.activeFile = activeFile;
    if (taskId !== undefined) this.taskId = taskId;
  }

  public isQueueableMessage(type: string): boolean {
    return (
      type.startsWith("task:") ||
      type.startsWith("contract:") ||
      type.startsWith("sharing:lane_shadow_") ||
      type === "sharing:file_focus_change"
    );
  }

  public getQueuedMessageCount(): number {
    return this.outboundQueue.length;
  }

  public send(type: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const envelope = {
        room_id: "room",
        node_id: this.options.node_id,
        ts: Date.now(),
        type,
        payload,
        sig: ""
      };
      this.ws.send(JSON.stringify(envelope));
    } else if (this.isQueueableMessage(type)) {
      if (this.outboundQueue.length >= this.maxQueueSize) {
        this.outboundQueue.shift(); // Drop oldest to enforce bounded queue limit
      }
      this.outboundQueue.push({ type, payload });
    }
  }

  private flushOutboundQueue(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.outboundQueue.length > 0) {
      const item = this.outboundQueue.shift();
      if (item) {
        this.send(item.type, item.payload);
      }
    }
  }

  private sendHello(): void {
    const hello: HelloPayload = {
      node_id: this.options.node_id,
      join_token: this.options.join_token,
      workspace_path: this.options.workspace_path,
      lane: this.options.lane,
      capabilities: { cli: "unknown", platform: process.platform, version: "0.1.0" }
    };
    this.send("session:hello", hello);
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const hb: HeartbeatPayload = {
        status: this.status,
        task_id: this.taskId,
        contract_version: this.contractVersion,
        active_file: this.activeFile
      };
      this.send("session:heartbeat", hb);
    }, this.options.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleMessage(raw: string): void {
    try {
      const envelope = MessageEnvelopeSchema.parse(JSON.parse(raw));

      if (envelope.type === "session:room_snapshot") {
        this.onSnapshot?.(envelope.payload as RoomSnapshotPayload);

        // Handshake completion (Issue 18): resolve connect() if pending, otherwise trigger onReconnect
        if (this.connectResolve) {
          const resolve = this.connectResolve;
          this.connectResolve = undefined;
          this.connectReject = undefined;
          resolve();
        } else {
          this.onReconnect?.();
        }

        // Offline queue flushing (Issue 17)
        this.flushOutboundQueue();
        return;
      }

      this.onMessage?.(envelope.type, envelope.payload);
    } catch {
      // Drop malformed messages
    }
  }
}
