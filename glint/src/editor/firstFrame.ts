import { waitForMaterial } from '../lib/material';

/** Keep the native editor hidden until the final material and canvas can paint.
 * Cancellation covers close/reopen and StrictMode, including the second frame. */
export async function presentEditorFrame(present:()=>Promise<void>, cancelled:()=>boolean):Promise<void> {
  await waitForMaterial();
  await document.fonts?.ready;
  await waitForMaterial();
  if(cancelled()) return;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  if(!cancelled()) await present();
}
