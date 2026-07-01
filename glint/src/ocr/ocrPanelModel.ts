/** ocrPanelModel.ts — pure view-logic for the OCR review panel, unit-tested apart
 * from React (the project's convention: logic in a model, thin component on top). */
import type { OcrResult } from "../lib/ocr";

/** Whether the result carries any text to show/act on. */
export const hasText = (res: OcrResult | null): boolean => !!(res && res.text);

/** The header counts line, e.g. "2 lines · 11 chars". */
export const countsLabel = (res: OcrResult): string =>
  `${res.line_count} lines · ${res.text.length} chars`;

/** What Copy should put on the clipboard: the current selection if non-empty,
 * otherwise the whole value. `start`/`end` are textarea selection offsets. */
export const copyTarget = (value: string, start: number, end: number): string => {
  const sel = value.substring(start, end);
  return sel.length > 0 ? sel : value;
};
