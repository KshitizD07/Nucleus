import fs from "node:fs";
import path from "node:path";

export type EventType =
  | "node_joined"
  | "node_severed"
  | "task_claimed"
  | "task_status_changed"
  | "contract_lock_acquired"
  | "contract_lock_released"
  | "contract_updated"
  | "critique_filed"
  | "task_approved";

export interface RoomEvent {
  ts: number;
  type: EventType;
  payload: Record<string, unknown>;
}

export class EventLog {
  private readonly logPath: string;

  constructor(logDir: string, roomId: string) {
    const dir = path.resolve(logDir);
    fs.mkdirSync(dir, { recursive: true });
    this.logPath = path.join(dir, `${roomId}.jsonl`);
  }

  public append(type: EventType, payload: Record<string, unknown>): void {
    const event: RoomEvent = { ts: Date.now(), type, payload };
    fs.appendFileSync(this.logPath, JSON.stringify(event) + "\n", "utf8");
  }

  public replay(): RoomEvent[] {
    if (!fs.existsSync(this.logPath)) return [];
    return fs
      .readFileSync(this.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RoomEvent);
  }
}
