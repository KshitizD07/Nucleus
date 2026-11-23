import { describe, it, expect, beforeEach } from "vitest";
import { LeaseMutex } from "./mutex.js";

describe("LeaseMutex (Contract Concurrency Control)", () => {
  let mutex: LeaseMutex;

  beforeEach(() => {
    mutex = new LeaseMutex();
  });

  it("should grant a lock to a requester", () => {
    const granted = mutex.acquire("CONTRACT/api.md", "node-1", 15);
    expect(granted).toBe(true);

    const lock = mutex.getLock("CONTRACT/api.md");
    expect(lock).not.toBeNull();
    expect(lock?.holderId).toBe("node-1");
  });

  it("should prevent another node from acquiring an active lock", () => {
    mutex.acquire("CONTRACT/api.md", "node-1", 15);
    const contested = mutex.acquire("CONTRACT/api.md", "node-2", 15);
    expect(contested).toBe(false);
  });

  it("should allow the same holder to renew their lease", () => {
    mutex.acquire("CONTRACT/api.md", "node-1", 15);
    const renewed = mutex.acquire("CONTRACT/api.md", "node-1", 20);
    expect(renewed).toBe(true);
  });

  it("should allow releasing a held lock", () => {
    mutex.acquire("CONTRACT/api.md", "node-1", 15);
    const released = mutex.release("CONTRACT/api.md", "node-1");
    expect(released).toBe(true);

    // Now node-2 can claim it
    const claimed = mutex.acquire("CONTRACT/api.md", "node-2", 15);
    expect(claimed).toBe(true);
  });

  it("should reject releasing a lock held by someone else", () => {
    mutex.acquire("CONTRACT/api.md", "node-1", 15);
    const badRelease = mutex.release("CONTRACT/api.md", "node-2");
    expect(badRelease).toBe(false);
  });
});
