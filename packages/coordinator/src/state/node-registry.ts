export type NodeStatus = "idle" | "active" | "review";

export interface NodeRecord {
  node_id: string;
  lane: string;
  status: NodeStatus;
  task_id: string | null;
  contract_version: number;
  active_file: string | null;
  last_heartbeat_at: number;
}

export class NodeRegistry {
  private readonly nodes: Map<string, NodeRecord> = new Map();

  public register(node: Omit<NodeRecord, "last_heartbeat_at">): void {
    this.nodes.set(node.node_id, { ...node, last_heartbeat_at: Date.now() });
  }

  public remove(node_id: string): boolean {
    return this.nodes.delete(node_id);
  }

  public updateHeartbeat(
    node_id: string,
    update: Partial<Pick<NodeRecord, "status" | "task_id" | "contract_version" | "active_file">>
  ): boolean {
    const node = this.nodes.get(node_id);
    if (!node) return false;
    Object.assign(node, update, { last_heartbeat_at: Date.now() });
    return true;
  }

  public get(node_id: string): NodeRecord | undefined {
    return this.nodes.get(node_id);
  }

  public getAll(): NodeRecord[] {
    return Array.from(this.nodes.values());
  }

  public evictStale(timeoutMs: number = 20_000): string[] {
    const now = Date.now();
    const evicted: string[] = [];
    for (const [id, node] of this.nodes) {
      if (now - node.last_heartbeat_at > timeoutMs) {
        this.nodes.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }
}
