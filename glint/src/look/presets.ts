import { useSyncExternalStore } from "react";
import { cloneLook, hydrateLook, type LookConfig } from "./model";

export interface LookPreset { id: string; name: string; look: LookConfig }
const KEY = "glint.look-presets.v1";
let cache: LookPreset[] = [];
const listeners = new Set<() => void>();
export function parsePresets(raw: string | null): LookPreset[] {
  try {
    const data = JSON.parse(raw ?? "[]");
    return Array.isArray(data) ? data.filter((p) => typeof p?.id === "string" && typeof p?.name === "string" && p?.look?.background && p?.look?.aspect)
      .map((p) => ({ id: p.id, name: p.name, look: hydrateLook(p.look) })) : [];
  } catch { return []; }
}
function reload() {
  cache = parsePresets(localStorage.getItem(KEY));
  listeners.forEach((fn) => fn());
}
if (typeof window !== "undefined") {
  reload();
  window.addEventListener("storage", (e) => { if (e.key === KEY) reload(); });
}
export function savePreset(name: string, look: LookConfig): void {
  const label = name.trim();
  if (!label) throw new Error("Enter a preset name.");
  const current = parsePresets(localStorage.getItem(KEY));
  const existing = current.find((p) => p.name === label);
  const preset = { id: existing?.id ?? crypto.randomUUID(), name: label, look: cloneLook(look) };
  localStorage.setItem(KEY, JSON.stringify([...current.filter((p) => p.id !== preset.id), preset]));
  reload();
}
export const useLookPresets = () => useSyncExternalStore(
  (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  () => cache,
);
