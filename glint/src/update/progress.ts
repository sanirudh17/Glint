/** Small pure formatters shared by the update popup + settings panel. */

/** Percentage 0–100 for a known total, or null when the total is unknown. */
export function pct(downloaded: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

/** Human "12.3 MB" from a byte count. */
export function mb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "12.3 MB of 99.1 MB" (or just the downloaded amount when total is unknown). */
export function progressLabel(downloaded: number, total: number | null): string {
  return total && total > 0 ? `${mb(downloaded)} of ${mb(total)}` : mb(downloaded);
}

/** localStorage key holding the version whose popup the user dismissed. */
export const DISMISS_KEY = "glint.dismissedUpdate";
