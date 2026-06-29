import { describe, it, expect } from "vitest";
import { mmss } from "./ControlBar";

describe("mmss formatter", () => {
  it("formats 0 as 00:00", () => {
    expect(mmss(0)).toBe("00:00");
  });
  it("formats 59 as 00:59", () => {
    expect(mmss(59)).toBe("00:59");
  });
  it("formats 60 as 01:00", () => {
    expect(mmss(60)).toBe("01:00");
  });
  it("formats 90 as 01:30", () => {
    expect(mmss(90)).toBe("01:30");
  });
  it("formats 3661 as 61:01", () => {
    expect(mmss(3661)).toBe("61:01");
  });
});
