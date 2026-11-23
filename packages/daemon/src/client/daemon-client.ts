import { WebSocket } from "ws";
import { MessageEnvelopeSchema } from "@nucleus/protocol";
import type { HelloPayload, HeartbeatPayload, RoomSnapshotPayload } from "@nucleus/protocol";

export type DaemonStatus = "idle" | "active" | "review";

export interface DaemonClientOptions {
  url: string;
  node_id: string;
  join_token: string;
  workspace_path: string;
  lane: string;
  heartbeatIntervalMs?: number;
}

export class DaemonClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private status: DaemonStatus = "idle";
  private activeFile: string | null = null;
  private contractVersion: number = 0;
  private taskId: string | null = null;
  private readonly options: Required<DaemonClientOptions>;

  public onSnapshot?: (snapshot: RoomSnapshotPayload) => void;
  public onMessage?: (type: string, payload: unknown) => void;
  public onDisconnect?: (reason: string) => void;

  constructor(options: DaemonClientOptions) {
    this.options = { heartbeatIntervalMs: 2000, ...options };
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.options.url);

      this.ws.once("open", () => {
        this.sendHello();
        resolve();
      });

      this.ws.once("error", reject);

      this.ws.on("message", (raw) => this.handleMessage(raw.toString()));

      this.ws.on("close", (code, reason) => {
        this.stopHeartbeat();
        const msg = reason?.toString() ?? "unknown";
        console.log(`[Daemon] Disconnected: ${code} - ${msg}`);
        this.onDisconnect?.(msg);
      });
    });
  }

  public sever(): void {
    this.stopHeartbeat();
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

  public setStatus(status: DaemonStatus, activeFile?: string | null, taskId?: string | null): void {
    this.status = status;
    if (activeFile !== undefined) this.activeFile = activeFile;
    if (taskId !== undefined) this.taskId = taskId;
  }

  public send(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const envelope = {
      room_id: "room",
      node_id: this.options.node_id,
      ts: Date.now(),
      type,
      payload,
      sig: ""
    };
    this.ws.send(JSON.stringify(envelope));
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
        return;
      }

      this.onMessage?.(envelope.type, envelope.payload);
    } catch {
      // Drop malformed messages
    }
  }
}
