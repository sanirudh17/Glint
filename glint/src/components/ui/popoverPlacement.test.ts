import { describe, expect, it } from 'vitest';
import { popoverPlacement } from './popoverPlacement';

describe('action popup placement', () => {
  it.each([
    { left: 740, right: 860, top: 70, bottom: 102 },
    { left: 40, right: 160, top: 110, bottom: 142 },
  ])('keeps both right-edge and wrapped triggers inside a compact window', (anchor) => {
    const menu = popoverPlacement(anchor, { width: 882, height: 603 });
    expect(menu.left).toBeGreaterThanOrEqual(8);
    expect(menu.left + menu.width).toBeLessThanOrEqual(874);
    expect(menu.maxHeight).toBeGreaterThan(180);
    if (anchor.left < 441) expect(menu.left).toBe(anchor.left);
  });
  it('fits a narrow viewport without horizontal overflow', () => {
    const menu = popoverPlacement({ right: 140, top: 70, bottom: 102 }, { width: 240, height: 400 });
    expect(menu.width).toBe(224);
    expect(menu.left).toBe(8);
  });
  it('opens above a low trigger and bounds the scrollable height', () => {
    const menu = popoverPlacement({ right: 860, top: 500, bottom: 532 }, { width: 882, height: 603 });
    expect(menu.top).toBeUndefined();
    expect(menu.bottom).toBe(109);
    expect(menu.maxHeight).toBe(486);
  });
});
