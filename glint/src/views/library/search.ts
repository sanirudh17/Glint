import type { CaptureItem } from "../../lib/captures";

/** True when `query` (case-insensitive substring) matches the capture's title, kind, or
 *  human-readable date. Empty/whitespace query matches everything. */
export function matchesCapture(item: CaptureItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const date = new Date(item.created_at * 1000)
    .toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    })
    .toLowerCase();
  const hay = [item.title ?? "", item.kind, date].join(" ").toLowerCase();
  return hay.includes(q);
}
