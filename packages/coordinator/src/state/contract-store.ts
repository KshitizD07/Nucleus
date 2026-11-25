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
  private realContractDir: string;

  constructor(contractDir: string) {
    this.contractDir = path.resolve(contractDir);
    fs.mkdirSync(this.contractDir, { recursive: true });
    try {
      this.realContractDir = fs.existsSync(this.contractDir)
        ? fs.realpathSync(this.contractDir)
        : this.contractDir;
    } catch {
      this.realContractDir = this.contractDir;
    }
    this.loadFromDisk();
  }

  private getEffectiveRealDir(): string {
    try {
      if (fs.existsSync(this.contractDir)) {
        this.realContractDir = fs.realpathSync(this.contractDir);
      }
    } catch {}
    return this.realContractDir;
  }

  private isContained(parent: string, child: string): boolean {
    const parentNorm = process.platform === "win32" ? parent.toLowerCase() : parent;
    const childNorm = process.platform === "win32" ? child.toLowerCase() : child;

    const parentWithSep = parentNorm.endsWith(path.sep) ? parentNorm : parentNorm + path.sep;
    const matchesPrefix = childNorm === parentNorm || childNorm.startsWith(parentWithSep);

    const rel = path.relative(parent, child);
    return matchesPrefix && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  public resolveSafePath(filePath: string): string {
    const resolved = path.resolve(this.contractDir, filePath);

    // 1. Lexical containment check
    if (!this.isContained(this.contractDir, resolved)) {
      throw new Error(`Security Exception: Contract path traversal outside contract directory: ${filePath}`);
    }

    // 2. Realpath containment check
    const effectiveReal = this.getEffectiveRealDir();
    try {
      if (fs.existsSync(resolved)) {
        const real = fs.realpathSync(resolved);
        if (!this.isContained(effectiveReal, real)) {
          throw new Error(`Security Exception: Contract symlink traversal outside contract directory: ${filePath}`);
        }
      } else if (fs.existsSync(this.contractDir)) {
        let curr = path.dirname(resolved);
        while (this.isContained(this.contractDir, curr) && !fs.existsSync(curr) && curr !== path.dirname(curr)) {
          curr = path.dirname(curr);
        }
        if (this.isContained(this.contractDir, curr) && fs.existsSync(curr)) {
          const realParent = fs.realpathSync(curr);
          if (!this.isContained(effectiveReal, realParent)) {
            throw new Error(`Security Exception: Contract symlink traversal outside contract directory: ${filePath}`);
          }
        }
      }
    } catch (err: any) {
      if (err.message && err.message.startsWith("Security Exception:")) {
        throw err;
      }
    }

    return resolved;
  }

  public isValidPath(filePath: string): boolean {
    try {
      this.resolveSafePath(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.contractDir)) return;
    const files = fs.readdirSync(this.contractDir);
    for (const f of files) {
      const full = path.join(this.contractDir, f);
      if (fs.statSync(full).isFile()) {
        const content = fs.readFileSync(full, "utf8");
        this.entries.set(f, {
          filePath: f,
          content,
          version: 1,
          updatedAt: Date.now()
        });
      }
    }
  }

  public update(filePath: string, content: string): ContractEntry {
    const fullPath = this.resolveSafePath(filePath);

    const existing = this.entries.get(filePath);
    const version = existing ? existing.version + 1 : 1;
    const entry: ContractEntry = { filePath, content, version, updatedAt: Date.now() };
    this.entries.set(filePath, entry);

    // Persist to disk atomically
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const tempPath = path.join(
      path.dirname(fullPath),
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
    );
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, fullPath);

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
