import { describe, it, expect } from "vitest";
import { nextPaint } from "./nextPaint";

describe("nextPaint", () => {
  it("resolves only after TWO animation frames (a paint has committed)", async () => {
    const queue: Array<() => void> = [];
    const raf = (cb: () => void) => { queue.push(cb); };

    let resolved = false;
    const p = nextPaint(raf).then(() => { resolved = true; });

    // Nothing scheduled to run yet.
    expect(queue.length).toBe(1);
    expect(resolved).toBe(false);

    // Frame 1 fires → should schedule frame 2, still not resolved.
    queue.shift()!();
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(queue.length).toBe(1);

    // Frame 2 fires → now resolved.
    queue.shift()!();
    await p;
    expect(resolved).toBe(true);
  });

  it("resolves via the default scheduler (no injected raf)", async () => {
    await expect(nextPaint()).resolves.toBeUndefined();
  });
});
