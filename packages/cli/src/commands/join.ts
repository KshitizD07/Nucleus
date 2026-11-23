import path from "node:path";
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
        this.taskReplica?.applySnapshot(snapshot.tasks);
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
        this.taskReplica?.applyUpdate(payload);
        if (payload.status === "approved") {
          console.log(`\n🎉 Task [${payload.id}] was APPROVED by Critique Gate!`);
          console.log(`🚀 Ready to git commit and push to remote!\n`);
        } else if (payload.status === "changes_requested") {
          console.log(`\n⚠️ Task [${payload.id}] CHANGES_REQUESTED by Critique Gate.`);
          console.log(`🔍 Inspect .nucleus/critiques/${payload.id}.md to view required fixes.\n`);
        } else {
          console.log(`[Tasks] Task [${payload.id}] -> status: ${payload.status}`);
        }
      }
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

    return this.client;
  }

  public stop(): void {
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
