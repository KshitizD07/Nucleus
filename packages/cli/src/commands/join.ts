import path from "node:path";
import fs from "node:fs";
import type { TaskItem } from "@nucleus/protocol";
import {
  DaemonClient,
  PeersIndexManager,
  ShadowMirror,
  ContractReplica,
  WorkspaceDiffWatcher,
  TaskBoardReplica
} from "@nucleus/daemon";

export interface JoinRunnerOptions {
  url: string;
  token: string;
  lane: string;
  nodeId?: string;
  workspaceRoot?: string;
}

export class JoinRunner {
  private client: DaemonClient | null = null;
  private diffWatcher: WorkspaceDiffWatcher | null = null;
  private peersManager: PeersIndexManager | null = null;
  private shadowMirror: ShadowMirror | null = null;
  private contractReplica: ContractReplica | null = null;
  private taskReplica: TaskBoardReplica | null = null;
  private taskWatcher: fs.FSWatcher | null = null;
  private taskDebounceTimer: NodeJS.Timeout | null = null;
  private isApplyingInbound = false;
  private knownTasksMap: Map<string, TaskItem> = new Map();
  private readonly options: Required<JoinRunnerOptions>;

  constructor(options: JoinRunnerOptions) {
    const ws = path.resolve(options.workspaceRoot || process.cwd());
    this.options = {
      url: options.url,
      token: options.token,
      lane: options.lane,
      nodeId: options.nodeId || `node-${options.lane}-${Math.random().toString(36).slice(2, 7)}`,
      workspaceRoot: ws
    };
  }

  public async start(): Promise<DaemonClient> {
    const { url, token, lane, nodeId, workspaceRoot } = this.options;

    this.peersManager = new PeersIndexManager(workspaceRoot);
    this.shadowMirror = new ShadowMirror(workspaceRoot);
    this.contractReplica = new ContractReplica({ workspaceRoot });
    this.taskReplica = new TaskBoardReplica(workspaceRoot);

    this.client = new DaemonClient({
      url,
      node_id: nodeId,
      join_token: token,
      workspace_path: workspaceRoot,
      lane
    });

    this.client.onSnapshot = (snapshot) => {
      console.log(`\nConnected to room [${snapshot.room_id}] as lane [${lane}]!`);
      for (const peer of snapshot.peers) {
        if (peer.node_id !== nodeId) {
          this.peersManager?.setPeer({
            nodeId: peer.node_id,
            lane: peer.lane,
            status: peer.status,
            activeFile: null
          });
        }
      }

      // Automatically sync room tasks to disk (.nucleus/tasks.json)
      if (snapshot.tasks && snapshot.tasks.length > 0) {
        this.isApplyingInbound = true;
        this.taskReplica?.applySnapshot(snapshot.tasks);
        this.knownTasksMap.clear();
        for (const t of snapshot.tasks) {
          this.knownTasksMap.set(t.id, { ...t });
        }
        this.isApplyingInbound = false;
        console.log(`[Tasks] Synchronized ${snapshot.tasks.length} tasks to .nucleus/tasks.json`);
      }

      // Automatically sync living contracts to disk (CONTRACT/)
      if (snapshot.contracts && snapshot.contracts.length > 0) {
        for (const c of snapshot.contracts) {
          this.contractReplica?.applyUpdate(c);
          console.log(`[Contract] Synchronized ${c.file_path} to CONTRACT/${c.file_path}`);
        }
      }
    };

    this.client.onMessage = (type, payload: any) => {
      if (type === "session:peer_joined") {
        if (payload.node_id !== nodeId) {
          this.peersManager?.setPeer({
            nodeId: payload.node_id,
            lane: payload.lane,
            status: "idle",
            activeFile: null
          });
          console.log(`[Room] Peer joined: ${payload.node_id} (lane: ${payload.lane})`);
        }
      } else if (type === "session:severed") {
        this.peersManager?.removePeer(payload.node_id);
        console.log(`[Room] Peer disconnected: ${payload.node_id}`);
      } else if (type === "contract:update") {
        this.contractReplica?.applyUpdate(payload);
        console.log(`[Contract] Updated: ${payload.file_path} (v${payload.version})`);
      } else if (type === "sharing:file_focus_change") {
        this.peersManager?.updatePeerFocus(
          payload.lane,
          payload.action === "idle" ? null : payload.file_path,
          payload.action === "editing" ? "active" : "idle"
        );
      } else if (type === "sharing:lane_shadow_sync") {
        this.shadowMirror?.applySync(payload);
      } else if (type === "task:status") {
        this.isApplyingInbound = true;
        this.taskReplica?.applyUpdate(payload);
        this.knownTasksMap.set(payload.id, { ...payload });
        this.isApplyingInbound = false;
        if (payload.status === "approved") {
          console.log(`\n🎉 Task [${payload.id}] was APPROVED by Critique Gate!`);
          console.log(`🚀 Ready to git commit and push to remote!\n`);
        } else if (payload.status === "changes_requested") {
          console.log(`\n⚠️ Task [${payload.id}] CHANGES_REQUESTED by Critique Gate.`);
          console.log(`🔍 Inspect .nucleus/critiques/${payload.id}.md to view required fixes.\n`);
        } else {
          console.log(`[Tasks] Task [${payload.id}] -> status: ${payload.status}`);
        }
      } else if (type === "task:claim_failed") {
        console.error(`\n⚠️ Task claim rejected: ${payload.reason}`);
        if (payload.available_tasks && payload.available_tasks.length > 0) {
          console.error(`Available tasks in your lane: [${payload.available_tasks.join(", ")}]\n`);
        }
        if (this.knownTasksMap.size > 0) {
          this.isApplyingInbound = true;
          this.taskReplica?.applySnapshot(Array.from(this.knownTasksMap.values()));
          this.isApplyingInbound = false;
        }
      }
    };

    this.client.onReconnect = () => {
      console.log(`\n🔄 [Nucleus] Successfully reconnected to room!`);
      this.diffWatcher?.resume();
      console.log(`[Nucleus] Workspace watcher active. Context published to .nucleus/PEERS.md\n`);
    };

    await this.client.connect();

    // Start background diff & focus watcher
    this.diffWatcher = new WorkspaceDiffWatcher({
      workspaceRoot,
      lane,
      onDiffStream: (diff) => {
        this.client?.streamDiff(diff);
      },
      onFocusChange: (filePath, action) => {
        this.client?.notifyFocusChange(filePath, action);
      }
    });

    this.diffWatcher.start();
    console.log(`[Nucleus] Workspace watcher active. Context published to .nucleus/PEERS.md`);

    try {
      const sessionDir = path.resolve(workspaceRoot, ".nucleus");
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      fs.writeFileSync(
        path.resolve(sessionDir, "session.json"),
        JSON.stringify({ lane, nodeId, url }, null, 2),
        "utf8"
      );

      // Watch .nucleus/tasks.json for local CLI/agent edits and propagate to room
      const tasksFilePath = path.resolve(sessionDir, "tasks.json");
      this.taskWatcher = fs.watch(sessionDir, (event, filename) => {
        if (!filename || filename === "tasks.json") {
          if (this.isApplyingInbound) return;
          if (this.taskDebounceTimer) clearTimeout(this.taskDebounceTimer);
          this.taskDebounceTimer = setTimeout(() => {
            if (!fs.existsSync(tasksFilePath) || !this.client) return;
            try {
              const raw = fs.readFileSync(tasksFilePath, "utf8");
              const currentTasks: TaskItem[] = JSON.parse(raw);
              for (const current of currentTasks) {
                const prev = this.knownTasksMap.get(current.id);
                if (!prev) continue;

                // Local claim detected
                if ((prev.status === "unassigned" || !prev.assigned_to) && (current.status === "active" || current.status === "assigned") && current.assigned_to) {
                  this.client.claimTask(current.id);
                }
                // Local release detected
                else if (prev.status !== "unassigned" && current.status === "unassigned") {
                  this.client.updateTaskStatus(current.id, "unassigned");
                }
                // Local status update (e.g. in_review)
                else if (prev.status !== current.status) {
                  this.client.updateTaskStatus(current.id, current.status, current.branch);
                }
              }
            } catch {}
          }, 80);
        }
      });
    } catch {}

    return this.client;
  }

  public stop(): void {
    if (this.taskWatcher) {
      try {
        this.taskWatcher.close();
      } catch {}
      this.taskWatcher = null;
    }
    if (this.taskDebounceTimer) {
      clearTimeout(this.taskDebounceTimer);
      this.taskDebounceTimer = null;
    }

    try {
      const sessionFile = path.resolve(this.options.workspaceRoot, ".nucleus", "session.json");
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
      }
    } catch {}

    if (this.diffWatcher) {
      this.diffWatcher.stop();
      this.diffWatcher = null;
    }
    if (this.client) {
      this.client.sever();
      this.client = null;
      console.log(`[Nucleus] Disconnected from room.`);
    }
  }
}
