// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionLayer } from "./SelectionLayer";
import { commitCapture } from "../lib/captureIpc";

vi.mock("../lib/captureIpc", () => ({ commitCapture: vi.fn() }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<SelectionLayer monitorId={0} scale={1} imageDataUrl={null}
    loupePatch={null} cursorX={null} cursorY={null} />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function pointer(type: string, x: number, y: number, button = 0) {
  const layer = host.querySelector(".sl-layer");
  if (!layer) throw new Error("Selection layer missing");
  act(() => layer.dispatchEvent(Object.assign(new MouseEvent(type, {
    bubbles: true, clientX: x, clientY: y, button,
  }), { pointerId: 1 })));
}

describe("area selection", () => {
  it("captures on release using the final pointer position without Enter", () => {
    pointer("pointerdown", 100, 120);
    pointer("pointermove", 250, 200);
    pointer("pointerup", 300, 240);
    expect(commitCapture).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 120, w: 200, h: 120 }, 0);
  });

  it("normalizes a reverse drag even without a pointermove event", () => {
    pointer("pointerdown", 300, 240);
    pointer("pointerup", 100, 120);
    expect(commitCapture).toHaveBeenCalledExactlyOnceWith({ x: 100, y: 120, w: 200, h: 120 }, 0);
  });

  it("does not capture a click, a thin selection, or a right-button drag", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 100, 100);
    pointer("pointerdown", 100, 100);
    pointer("pointerup", 101, 200);
    pointer("pointerdown", 100, 100, 2);
    pointer("pointerup", 300, 300, 2);
    expect(commitCapture).not.toHaveBeenCalled();
  });

  it("does not capture an interrupted gesture on a later release", () => {
    pointer("pointerdown", 100, 100);
    pointer("pointermove", 300, 300);
    pointer("pointercancel", 300, 300);
    pointer("pointerup", 300, 300);
    expect(commitCapture).not.toHaveBeenCalled();
  });
});
