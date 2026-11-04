import { expect, it } from "vitest";
import { advanceExpiry, CARD_IDLE_MS } from "./expiry";
it("expires cards independently and preserves a hovered card's remaining time", () => {
  const older = advanceExpiry({ remaining: CARD_IDLE_MS, paused: false }, 6_000);
  const newer = { remaining: CARD_IDLE_MS, paused: false };
  expect(advanceExpiry(older, 2_000).remaining).toBe(0);
  expect(advanceExpiry(newer, 2_000).remaining).toBe(6_000);
  expect(advanceExpiry({ ...older, paused: true }, 12_000).remaining).toBe(2_000);
});
