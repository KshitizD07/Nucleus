import fs from "node:fs";
import path from "node:path";

export class WorkspaceJail {
  private readonly rootPath: string;
  private realRootPath: string;

  constructor(rootDirectory: string) {
    this.rootPath = path.resolve(rootDirectory);
    try {
      this.realRootPath = fs.existsSync(this.rootPath)
        ? fs.realpathSync(this.rootPath)
        : this.rootPath;
    } catch {
      this.realRootPath = this.rootPath;
    }
  }

  public getRoot(): string {
    return this.rootPath;
  }

  public getRealRoot(): string {
    return this.getEffectiveRealRoot();
  }

  private getEffectiveRealRoot(): string {
    try {
      if (fs.existsSync(this.rootPath)) {
        this.realRootPath = fs.realpathSync(this.rootPath);
      }
    } catch {}
    return this.realRootPath;
  }

  private isContained(parent: string, child: string): boolean {
    const parentNorm = process.platform === "win32" ? parent.toLowerCase() : parent;
    const childNorm = process.platform === "win32" ? child.toLowerCase() : child;

    const parentWithSep = parentNorm.endsWith(path.sep) ? parentNorm : parentNorm + path.sep;
    const matchesPrefix = childNorm === parentNorm || childNorm.startsWith(parentWithSep);

    const rel = path.relative(parent, child);
    return matchesPrefix && !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  public resolveSafe(relativeOrSubPath: string): string {
    const resolved = path.resolve(this.rootPath, relativeOrSubPath);

    // 1. Lexical containment check
    if (!this.isContained(this.rootPath, resolved)) {
      throw new Error(`Security Exception: Path traversal attempt outside workspace jail: ${relativeOrSubPath}`);
    }

    // 2. Realpath containment check (resolves symlinks and junctions)
    const effectiveRealRoot = this.getEffectiveRealRoot();
    try {
      if (fs.existsSync(resolved)) {
        const realTarget = fs.realpathSync(resolved);
        if (!this.isContained(effectiveRealRoot, realTarget)) {
          throw new Error(`Security Exception: Symlink traversal attempt outside workspace jail: ${relativeOrSubPath}`);
        }
      } else if (fs.existsSync(this.rootPath)) {
        // For non-existent targets, verify the nearest existing ancestor directory within rootPath
        let curr = path.dirname(resolved);
        while (this.isContained(this.rootPath, curr) && !fs.existsSync(curr) && curr !== path.dirname(curr)) {
          curr = path.dirname(curr);
        }
        if (this.isContained(this.rootPath, curr) && fs.existsSync(curr)) {
          const realParent = fs.realpathSync(curr);
          if (!this.isContained(effectiveRealRoot, realParent)) {
            throw new Error(`Security Exception: Symlink traversal attempt outside workspace jail: ${relativeOrSubPath}`);
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
}
