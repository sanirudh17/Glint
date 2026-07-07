import type { Style, ToolId } from "./model";

export type ToolStyles = Partial<Record<ToolId, Style>>;

const KEY = "glint.editor.toolStyles";

/** Serialize the per-tool style map to a JSON string. */
export function serializeToolStyles(map: ToolStyles): string {
  return JSON.stringify(map);
}

/** Parse a stored per-tool style map. Returns {} on any malformed input so a
 *  corrupt value degrades to defaults rather than throwing. Entries are kept
 *  only when the value looks like a Style (has a string `color`). */
export function parseToolStyles(raw: string | null): ToolStyles {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: ToolStyles = {};
    for (const [k, style] of Object.entries(v as Record<string, unknown>)) {
      if (style && typeof style === "object" && typeof (style as Style).color === "string") {
        out[k as ToolId] = style as Style;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Read the persisted map from localStorage (impure; safe in non-browser envs). */
export function loadToolStyles(): ToolStyles {
  try {
    return parseToolStyles(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

/** Persist the map to localStorage (impure; best-effort). */
export function saveToolStyles(map: ToolStyles): void {
  try {
    localStorage.setItem(KEY, serializeToolStyles(map));
  } catch {
    /* ignore — persistence is best-effort */
  }
}
