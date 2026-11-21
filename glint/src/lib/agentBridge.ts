/**
 * Agent bridge (main window only). The Glint MCP asks the running app to change
 * settings and hotkeys; native queues each request and this window runs it with
 * the SAME store actions the Settings page calls, so validation, persistence,
 * the theme/accent broadcast and side effects (taskbar, Explorer menu, OCR
 * indexing…) are identical to a person clicking. Requests are pulled
 * (`agent_next`), so none is lost if one arrives before this listener mounts.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore, type Settings, type RecordFxKey } from "../store/useAppStore";

interface AgentRequest {
  id: number;
  op: "settings_get" | "settings_set" | "hotkey_set" | "hotkeys_reset";
  args: Record<string, unknown> | null;
}

type Store = ReturnType<typeof useAppStore.getState>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Setter = (store: Store, value: any) => Promise<void>;

const fx = (key: RecordFxKey): Setter => (s, v) => s.setRecordFx(key, v);

/** Every user-facing setting, mapped to the Settings page's own action. */
export const SETTERS: Record<string, Setter> = {
  theme: (s, v) => s.setTheme(v),
  accent: (s, v) => s.setAccent(v),
  glass: (s, v) => s.setGlass(v),
  auto_save: (s, v) => s.setAutoSave(v),
  auto_copy: (s, v) => s.setAutoCopy(v),
  open_in_editor: (s, v) => s.setOpenInEditor(v),
  capture_on_release: (s, v) => s.setCaptureOnRelease(v),
  hide_desktop_icons: (s, v) => s.setHideDesktopIcons(v),
  quick_access_auto_close: (s, v) => s.setQuickAccessAutoClose(v),
  index_screenshot_text: (s, v) => s.setIndexScreenshotText(v),
  ocr_engine: (s, v) => s.setOcrEngine(v),
  explorer_menu_enabled: (s, v) => s.setExplorerMenu(v),
  include_cursor: (s, v) => s.setIncludeCursor(v),
  image_format: (s, v) => s.setImageFormat(v),
  jpeg_quality: (s, v) => s.setJpegQuality(v),
  capture_delay_secs: (s, v) => s.setCaptureDelay(v),
  sound_effects: (s, v) => s.setSoundEffects(v),
  shutter_sound: (s, v) => s.setShutterSound(v),
  show_in_taskbar: (s, v) => s.setShowInTaskbar(v),
  save_dir: (s, v) => s.setSaveDir(v),
  record_system_audio: (s, v) => s.setRecordSystemAudio(v),
  record_microphone: (s, v) => s.setRecordMicrophone(v),
  record_webcam: (s, v) => s.setRecordWebcam(v),
  record_webcam_movable: (s, v) => s.setRecordWebcamMovable(v),
  record_click_viz: fx("record_click_viz"),
  record_keystrokes: fx("record_keystrokes"),
  record_cursor_spotlight: fx("record_cursor_spotlight"),
  record_cursor_hide: fx("record_cursor_hide"),
  record_cursor_size: fx("record_cursor_size"),
  record_fps: (s, v) => s.setRecordFps(v),
  record_resolution: (s, v) => s.setRecordResolution(v),
  record_quality: (s, v) => s.setRecordQuality(v),
  webcam_device_id: (s, v) => s.setWebcamDevice(v),
  webcam_shape: (s, v) => s.setWebcamShape(v),
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function current(): Promise<Settings> {
  const store = useAppStore.getState();
  if (!store.settings) await store.loadSettings();
  const settings = useAppStore.getState().settings;
  if (!settings) throw new Error("Glint's settings aren't loaded yet.");
  return settings;
}

/** The store reports failures as toasts; surface the newest one as the error. */
function failure(label: string, toastsBefore: number): Error {
  const toasts = useAppStore.getState().toasts;
  const latest = toasts.length > toastsBefore ? toasts[toasts.length - 1].text : null;
  return new Error(latest ?? `Glint didn't accept ${label}.`);
}

export async function applySettings(changes: Record<string, unknown>): Promise<Settings> {
  await current();
  const unknown = Object.keys(changes).filter((key) => !(key in SETTERS));
  if (unknown.length) {
    throw new Error(`Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. Known: ${Object.keys(SETTERS).join(", ")}, launch_at_startup.`);
  }
  for (const [key, value] of Object.entries(changes)) {
    const store = useAppStore.getState();
    const toastsBefore = store.toasts.length;
    await SETTERS[key](store, value); // may throw (save_dir) or toast on rejection
    const now = useAppStore.getState().settings as unknown as Record<string, unknown> | null;
    if (!now || !same(now[key], value)) throw failure(`${key} = ${JSON.stringify(value)}`, toastsBefore);
  }
  return current();
}

async function run(request: AgentRequest): Promise<unknown> {
  const args = request.args ?? {};
  switch (request.op) {
    case "settings_get":
      return current();
    case "settings_set":
      return applySettings((args.changes ?? {}) as Record<string, unknown>);
    case "hotkey_set": {
      await current();
      const action = String(args.action ?? "");
      const accelerator = String(args.accelerator ?? "");
      await useAppStore.getState().setHotkey(action, accelerator); // throws a readable message on conflict
      return (await current()).hotkeys;
    }
    case "hotkeys_reset": {
      await current();
      const toastsBefore = useAppStore.getState().toasts.length;
      await useAppStore.getState().resetHotkeys();
      if (useAppStore.getState().toasts.length > toastsBefore) throw failure("the shortcut reset", toastsBefore);
      return (await current()).hotkeys;
    }
    default:
      throw new Error(`Unknown agent request "${String(request.op)}"`);
  }
}

/** Start serving agent requests; returns a cleanup function. */
export function startAgentBridge(): () => void {
  let busy = false;
  let alive = true;
  const drain = async () => {
    if (busy) return;
    busy = true;
    try {
      while (alive) {
        const request = await invoke<AgentRequest | null>("agent_next");
        if (!request) break;
        try {
          const result = await run(request);
          await invoke("agent_done", { id: request.id, result, error: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await invoke("agent_done", { id: request.id, result: null, error: message }).catch(() => {});
        }
      }
    } finally {
      busy = false;
    }
  };
  void drain();
  const un = listen("agent-request", () => void drain());
  return () => {
    alive = false;
    void un.then((f) => f());
  };
}
