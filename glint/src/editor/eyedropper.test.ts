import { describe, it, expect } from "vitest";
import { rgbToHex, pixelToHex } from "./eyedropper";

describe("rgbToHex", () => {
  it("formats channels as lowercase 6-digit hex", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
    expect(rgbToHex(255, 128, 0)).toBe("#ff8000");
  });
});

describe("pixelToHex", () => {
  // 2x1 image: pixel(0)=red, pixel(1)=green (RGBA rows).
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  it("reads the pixel at (x,y) using row-major RGBA", () => {
    expect(pixelToHex(data, 2, 0, 0)).toBe("#ff0000");
    expect(pixelToHex(data, 2, 1, 0)).toBe("#00ff00");
  });
  it("returns null when out of bounds", () => {
    expect(pixelToHex(data, 2, -1, 0)).toBeNull();
    expect(pixelToHex(data, 2, 2, 0)).toBeNull();
  });
});
