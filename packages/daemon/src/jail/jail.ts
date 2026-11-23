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
    if (!resolved.startsWith(this.rootPath)) {
      throw new Error(`Security Exception: Path traversal attempt outside workspace jail: ${relativeOrSubPath}`);
    }
    return resolved;
  }
}
