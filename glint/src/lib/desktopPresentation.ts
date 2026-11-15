import {invoke} from '@tauri-apps/api/core';
export async function finishDesktopPresentation(cancelled:()=>boolean=()=>false){
 if(cancelled())return;
 try{
  const prepared=await invoke<[number,boolean]|null>('window_material_prepare');
  if(!prepared||cancelled())return;
  const [token,applied]=prepared;
  document.documentElement.dataset.glass=String(applied);
  // Recommit the themed UI after native surface preparation, while cloaked.
  // A fresh layout plus two compositor frames follows Carbon's paint gate.
  void document.documentElement.offsetWidth;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  if(!cancelled())await invoke<boolean>('window_material_presented',{token});
 }catch{/* Plain Vite has no native compositor. Native timeout retains solid fallback. */}
}
