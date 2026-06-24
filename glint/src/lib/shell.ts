/**
 * shell.ts — typed wrappers for the Explorer "Open in Glint" shell-verb commands.
 * HKCU-only registry ops; no admin, no network.
 */
import { invoke } from "@tauri-apps/api/core";

export const registerExplorerMenu = (): Promise<void> =>
  invoke<void>("shell_register_explorer_menu");

export const unregisterExplorerMenu = (): Promise<void> =>
  invoke<void>("shell_unregister_explorer_menu");

/** One-shot: did a cold-start "Open in Glint" stash an external image? */
export const consumePendingExternalOpen = (): Promise<boolean> =>
  invoke<boolean>("consume_pending_external_open");
