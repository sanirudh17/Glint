/** ocr.ts — typed wrappers for the OCR commands. */
import { invoke } from "@tauri-apps/api/core";

export interface OcrResult {
  text: string;
  line_count: number;
  word_count: number;
}

export const ocrResult = (): Promise<OcrResult | null> =>
  invoke<OcrResult | null>("ocr_result");
