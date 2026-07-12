import { describe, it, expect } from "vitest";
import { computeLayout, exportPixelRatio, normalizeRect, resolveRadiusPx, type FrameLayoutInput } from "./composition";

const off: FrameLayoutInput = { enabled: false, padding: 0, radius: 0, shadow: 0, aspect: "auto" };
const on = (over: Partial<FrameLayoutInput> = {}): FrameLayoutInput =>
  ({ enabled: true, padding: 100, radius: 0, shadow: 0, aspect: "auto", ...over });

describe("composition", () => {
  it("frame off → composition equals content, no offset", () => {
    const l = computeLayout(800, 600, null, off);
    expect(l).toMatchObject({
      contentW: 800, contentH: 600, contentX: 0, contentY: 0,
      compositionW: 800, compositionH: 600, paddingPx: 0, cropX: 0, cropY: 0,
    });
  });

  it("crop sets content size and crop origin", () => {
    const l = computeLayout(800, 600, { x: 100, y: 50, w: 400, h: 200 }, off);
    expect(l).toMatchObject({ contentW: 400, contentH: 200, cropX: 100, cropY: 50, compositionW: 400 });
  });

  it("padding 100 adds 25% of the long edge per side", () => {
    const l = computeLayout(400, 200, null, on({ padding: 100 })); // paddingPx = round(0.25*400)=100
    expect(l.paddingPx).toBe(100);
    expect(l.compositionW).toBe(600);
    expect(l.compositionH).toBe(400);
    expect(l.contentX).toBe(100);
    expect(l.contentY).toBe(100);
  });

  it("aspect 1:1 enlarges the deficient axis and re-centers", () => {
    // content 400x200, padding 100 → 600x400, then 1:1 → 600x600
    const l = computeLayout(400, 200, null, on({ padding: 100, aspect: "1:1" }));
    expect(l.compositionW).toBe(600);
    expect(l.compositionH).toBe(600);
    expect(l.contentX).toBe(100); // (600-400)/2
    expect(l.contentY).toBe(200); // (600-200)/2
  });

  it("aspect 16:9 widens a too-tall composition", () => {
    // content 200x200, padding 0 → comp 200x200, 16:9 → W=round(200*16/9)=356
    const l = computeLayout(200, 200, null, on({ padding: 0, aspect: "16:9" }));
    expect(l.compositionH).toBe(200);
    expect(l.compositionW).toBe(Math.round(200 * (16 / 9)));
  });

  it("chrome none → chromeH 0 and layout unchanged", () => {
    const l = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "none" } }));
    expect(l.chromeH).toBe(0);
    expect(l.compositionH).toBe(400); // same as the padding-only case
    expect(l.contentY).toBe(100);
  });

  it("chrome window adds a bar above the image", () => {
    // content 400 wide → barH = clamp(round(400*0.045)=18, 28, 120) = 28
    const l = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "window" } }));
    expect(l.chromeH).toBe(28);
    expect(l.compositionH).toBe(428); // 400 + chromeH
    expect(l.compositionW).toBe(600); // unchanged
    expect(l.contentY).toBe(128);     // image pushed down by chromeH
  });

  it("chrome browser has the same single-row bar height as window", () => {
    const w = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "window" } }));
    const b = computeLayout(400, 200, null, on({ padding: 100, chrome: { style: "browser" } }));
    expect(b.chromeH).toBe(w.chromeH);
  });

  it("bar height respects the clamp on a large capture", () => {
    // content 4000 wide → round(4000*0.045)=180 → clamped to 120
    const l = computeLayout(4000, 2000, null, on({ padding: 0, chrome: { style: "window" } }));
    expect(l.chromeH).toBe(120);
  });

  it("frame disabled → chromeH 0 even with a chrome style set", () => {
    const l = computeLayout(400, 200, null, { enabled: false, padding: 0, radius: 0, shadow: 0, aspect: "auto", chrome: { style: "window" } });
    expect(l.chromeH).toBe(0);
  });

  it("exportPixelRatio maps stage width back to native composition", () => {
    const l = computeLayout(600, 400, null, off);
    expect(exportPixelRatio(l, 300)).toBe(2);
    expect(exportPixelRatio(l, 0)).toBe(1); // guard
  });

  it("normalizeRect folds a negative (up-left) drag", () => {
    expect(normalizeRect({ x: 100, y: 100, w: -40, h: -20 })).toEqual({ x: 60, y: 80, w: 40, h: 20 });
  });

  it("resolveRadiusPx: 100% fully rounds the short axis on any size", () => {
    expect(resolveRadiusPx(100, 1920, 1080)).toBe(540); // half the shorter edge → semicircle
    expect(resolveRadiusPx(100, 400, 400)).toBe(200);
  });

  it("resolveRadiusPx scales with the shorter edge (size-independent look)", () => {
    expect(resolveRadiusPx(50, 1000, 2000)).toBe(250); // 0.5 * 0.5 * min(1000,2000)
    expect(resolveRadiusPx(0, 1920, 1080)).toBe(0);
  });

  it("resolveRadiusPx clamps out-of-range percentages", () => {
    expect(resolveRadiusPx(150, 400, 400)).toBe(200); // >100 clamps to full
    expect(resolveRadiusPx(-20, 400, 400)).toBe(0); // <0 clamps to none
  });
});
