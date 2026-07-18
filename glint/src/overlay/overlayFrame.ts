/**
 * overlayFrame.ts — the "decode-then-show" load step for the capture overlay.
 *
 * Plan A for the cold-idle stall: the overlay window is reused hidden between
 * captures, and Chromium throttles a hidden webview while the app is idle. The
 * old flow emitted `overlay-refresh` and immediately `show()`ed, so the FIRST
 * paint after idle had to wake the renderer AND fetch + decode a multi-MB PNG on
 * the visible critical path — the ~1s freeze + "lit-up" flash users saw.
 *
 * Instead we fetch the frozen frame and DECODE it (`img.decode()` runs while the
 * window is still hidden), then tell the backend to show. Showing then only has
 * to composite an already-decoded image.
 *
 * This module is intentionally free of any Tauri imports so the ordering logic is
 * unit-testable in jsdom; the real wiring lives in captureIpc / OverlayApp.
 */

export interface LoadedFrame<T> {
  data: T;
  /** ms spent fetching the frozen frame over IPC. */
  fetchMs: number;
  /** ms spent decoding the frozen PNG (the cost we move off the post-show paint). */
  decodeMs: number;
}

/**
 * Fetch the frozen frame, then decode it — in that order — reporting how long
 * each step took. A decode failure is non-fatal: we still return the data so the
 * capture proceeds (worst case the paint decodes on show, i.e. the old behavior).
 *
 * `now` is injectable so timings are deterministic in tests.
 */
export async function loadFrameWith<T extends { imageDataUrl: string }>(
  fetchData: () => Promise<T>,
  decode: (url: string) => Promise<void>,
  now: () => number = () => performance.now(),
): Promise<LoadedFrame<T>> {
  const t0 = now();
  const data = await fetchData();
  const t1 = now();
  try {
    await decode(data.imageDataUrl);
  } catch {
    // Decode can reject (detached image, unsupported data) — proceed anyway.
  }
  const t2 = now();
  return { data, fetchMs: Math.round(t1 - t0), decodeMs: Math.round(t2 - t1) };
}

/**
 * Decode a data-URL image off the paint path. Resolves once the bytes are decoded
 * and ready to composite, so a later CSS `background-image` with the same URL hits
 * the decode cache and paints without a stall.
 */
export function decodeDataUrl(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  return img.decode();
}
