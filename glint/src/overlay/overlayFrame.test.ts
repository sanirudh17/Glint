import { describe, it, expect } from "vitest";
import { loadFrameWith } from "./overlayFrame";

describe("loadFrameWith (decode-then-show ordering)", () => {
  it("fetches BEFORE decoding and reports both timings", async () => {
    const order: string[] = [];
    let clock = 0;
    const now = () => clock;

    const fetchData = async () => {
      order.push("fetch");
      clock += 40; // fetch took 40ms
      return { imageDataUrl: "data:image/png;base64,AAA" };
    };
    const decode = async (url: string) => {
      order.push(`decode:${url}`);
      clock += 100; // decode took 100ms
    };

    const frame = await loadFrameWith(fetchData, decode, now);

    // The whole point of Plan A: decode happens (after fetch), before we signal ready.
    expect(order).toEqual(["fetch", "decode:data:image/png;base64,AAA"]);
    expect(frame.fetchMs).toBe(40);
    expect(frame.decodeMs).toBe(100);
    expect(frame.data.imageDataUrl).toBe("data:image/png;base64,AAA");
  });

  it("swallows a decode failure and still returns the fetched frame", async () => {
    const fetchData = async () => ({ imageDataUrl: "x" });
    const decode = async () => {
      throw new Error("decode rejected (detached)");
    };

    const frame = await loadFrameWith(fetchData, decode, () => 0);

    expect(frame.data.imageDataUrl).toBe("x");
    expect(typeof frame.fetchMs).toBe("number");
    expect(typeof frame.decodeMs).toBe("number");
  });
});
