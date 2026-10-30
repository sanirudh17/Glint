import { invoke } from '@tauri-apps/api/core';

let revision = 0;
let settled: Promise<void> = Promise.resolve();
let requested: {glass:boolean;dark:boolean;system:boolean}|null=null;
export function applyMaterial(glass: boolean): Promise<void> {
  const dark=document.documentElement.dataset.theme!=='light';
  const system=document.documentElement.dataset.appearance==='system';
  if(requested?.glass===glass&&requested.dark===dark&&requested.system===system)return settled;
  requested={glass,dark,system};
  settled = updateMaterial(glass);
  return settled;
}
/** Follow a newer theme/material request if it supersedes one we're awaiting. */
export async function waitForMaterial(): Promise<void> {
  let pending: Promise<void>;
  do { pending = settled; await pending; } while (pending !== settled);
}
/** Native desktop acrylic, enabled only after the compositor accepts it. */
async function updateMaterial(glass: boolean): Promise<void> {
  const current = ++revision;
  const dark = document.documentElement.dataset.theme !== 'light';
  if (!glass) {
    // Paint opaque content before removing the compositor's backdrop. Otherwise
    // the desktop can show through the still-transparent WebView for one frame.
    document.documentElement.dataset.glass = 'false';
    await new Promise<void>(resolve => requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    if (current !== revision) return;
  }
  try {
    const applied = await invoke<boolean>('window_material', { glass, dark, system: document.documentElement.dataset.appearance === 'system' });
    if (current === revision) document.documentElement.dataset.glass = String(applied);
  } catch {
    if (current === revision) { document.documentElement.dataset.glass = 'false'; requested=null; }
  }
}
