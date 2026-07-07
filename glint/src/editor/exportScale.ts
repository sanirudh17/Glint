export type ExportScale = 1 | 2;

const KEY = "glint.editor.exportScale";

/** Only the literal "2" means 2×; everything else (incl. null/garbage) → 1×. */
export function parseExportScale(raw: string | null): ExportScale {
  return raw === "2" ? 2 : 1;
}

export function loadExportScale(): ExportScale {
  try {
    return parseExportScale(localStorage.getItem(KEY));
  } catch {
    return 1;
  }
}

export function saveExportScale(s: ExportScale): void {
  try {
    localStorage.setItem(KEY, String(s));
  } catch {
    /* ignore — best-effort */
  }
}

/** The flatten pixel ratio at the chosen export scale. */
export function scaledPixelRatio(baseRatio: number, scale: ExportScale): number {
  return baseRatio * scale;
}
