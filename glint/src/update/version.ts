/**
 * version.ts — pure version-comparison + update-notification logic.
 *
 * Glint versions are simple dotted numbers ("0.1.4"); GitHub release tags carry a
 * leading "v" ("v0.1.4"). We normalise both, compare numerically component by
 * component, and ignore any pre-release/build suffix ("0.1.4-rc.1" → 0.1.4). No
 * network here so the rules are unit-testable.
 */

/** Strip a leading "v"/"V" and any "-…"/"+…" suffix, then split into numbers. */
export function parseVersion(raw: string): number[] {
  const core = raw.trim().replace(/^v/i, "").split(/[-+]/, 1)[0] ?? "";
  return core.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/**
 * Compare two versions. Returns >0 if a>b, <0 if a<b, 0 if equal. Missing
 * trailing components are treated as 0 ("0.1" === "0.1.0").
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when `latest` is strictly newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0;
}

/**
 * Whether the one-time update popup should appear: only when a genuinely newer
 * version exists AND the user hasn't already dismissed the popup for THAT exact
 * version. Dismissing v0.1.3 must not suppress the popup for a later v0.1.4, and a
 * version equal to or older than the installed one never notifies.
 */
export function shouldNotify(args: {
  latest: string;
  current: string;
  dismissed: string | null;
}): boolean {
  const { latest, current, dismissed } = args;
  if (!isNewer(latest, current)) return false;
  if (dismissed && compareVersions(latest, dismissed) === 0) return false;
  return true;
}
