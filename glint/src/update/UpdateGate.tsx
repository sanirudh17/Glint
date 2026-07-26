/**
 * UpdateGate — mount the update popup ONLY in the main window.
 *
 * Every Glint window (main, HUD, overlay, editor, pins) mounts the same <App/>,
 * so a bare <UpdatePopup/> would appear in all of them. The popup belongs to the
 * main app surface alone; the others gate it out here. Outside Tauri (plain Vite),
 * getCurrentWindow throws — treat that as "not main" and render nothing.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { UpdatePopup } from "./UpdatePopup";

function isMainWindow(): boolean {
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return false;
  }
}

export function UpdateGate() {
  if (!isMainWindow()) return null;
  return <UpdatePopup />;
}
