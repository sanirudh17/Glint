import { describe, it, expect } from "vitest";
import { matchesCapture } from "./search";
import type { CaptureItem } from "../../lib/captures";

const item = (over: Partial<CaptureItem>): CaptureItem => ({
  id: 1, kind: "screenshot", path: "/x/Glint 2026-07-02 at 13.07.00.png",
  thumb_url: null, width: 800, height: 600, bytes: 1234,
  created_at: 1751461620, title: null, ...over,
});

describe("matchesCapture", () => {
  it("empty query matches all", () => {
    expect(matchesCapture(item({}), "")).toBe(true);
    expect(matchesCapture(item({}), "   ")).toBe(true);
  });
  it("matches the custom title case-insensitively", () => {
    expect(matchesCapture(item({ title: "Invoice March" }), "invoice")).toBe(true);
    expect(matchesCapture(item({ title: "Invoice" }), "receipt")).toBe(false);
  });
  it("matches the kind keyword", () => {
    expect(matchesCapture(item({ kind: "recording" }), "record")).toBe(true);
  });
  it("matches an untitled capture by its human date", () => {
    // The formatted date always includes the 4-digit year — derive it so this is
    // robust to the test runner's timezone.
    const it0 = item({ title: null });
    const year = String(new Date(it0.created_at * 1000).getFullYear());
    expect(matchesCapture(it0, year)).toBe(true);
  });
});
