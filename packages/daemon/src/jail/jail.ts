import path from "node:path";

export class WorkspaceJail {
  private readonly rootPath: string;

  constructor(rootDirectory: string) {
    this.rootPath = path.resolve(rootDirectory);
  }

  public getRoot(): string {
    return this.rootPath;
  }

  public resolveSafe(relativeOrSubPath: string): string {
    const resolved = path.resolve(this.rootPath, relativeOrSubPath);
    const rel = path.relative(this.rootPath, resolved);
    const rootWithSep = this.rootPath.endsWith(path.sep) ? this.rootPath : this.rootPath + path.sep;
    const isContained = resolved === this.rootPath || resolved.startsWith(rootWithSep);

    if (!isContained || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Security Exception: Path traversal attempt outside workspace jail: ${relativeOrSubPath}`);
    }
    return resolved;
  }
}
