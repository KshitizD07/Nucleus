import fs from "node:fs";
import path from "node:path";

export interface ContractEntry {
  filePath: string;
  content: string;
  version: number;
  updatedAt: number;
}

export class ContractStore {
  private readonly entries: Map<string, ContractEntry> = new Map();
  private readonly contractDir: string;

  constructor(contractDir: string) {
    this.contractDir = path.resolve(contractDir);
    fs.mkdirSync(this.contractDir, { recursive: true });
  }

  public update(filePath: string, content: string): ContractEntry {
    const existing = this.entries.get(filePath);
    const version = existing ? existing.version + 1 : 1;
    const entry: ContractEntry = { filePath, content, version, updatedAt: Date.now() };
    this.entries.set(filePath, entry);

    // Persist to disk so peers can replay after coordinator restart
    const fullPath = path.join(this.contractDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");

    return entry;
  }

  public get(filePath: string): ContractEntry | undefined {
    return this.entries.get(filePath);
  }

  public getAll(): ContractEntry[] {
    return Array.from(this.entries.values());
  }

  public currentVersion(filePath: string): number {
    return this.entries.get(filePath)?.version ?? 0;
  }
}
