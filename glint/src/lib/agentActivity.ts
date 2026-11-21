/** Settings → Agents: the agents' state and their recent actions, in plain words. */
export interface AgentStatus {
  /** A known agent id, or `client:<name>` for any other MCP client. */
  id: string;
  name: string;
  installed: boolean;
  configured: boolean;
  active: boolean;
  last_used: number | null;
}

export interface ActivityEntry {
  t: number;
  agent: string;
  client: string;
  tool: string;
  ok: boolean;
  state?: string;
  target?: string | null;
  detail?: Record<string, unknown>;
}

export interface AgentsOverview {
  agents: AgentStatus[];
  activity: ActivityEntry[];
}

const SHORTCUTS: Record<string, string> = {
  capture_area: "Capture area",
  capture_window: "Capture window",
  capture_fullscreen: "Capture fullscreen",
  capture_scroll: "Scrolling capture",
  record: "Record",
  copy_path: "Copy path",
  open_latest: "Open latest capture",
  capture_area_delayed: "Delayed capture area",
  capture_window_delayed: "Delayed capture window",
  capture_fullscreen_delayed: "Delayed capture fullscreen",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const human = (key: string) => key.replace(/^record_/, "recording ").replace(/_/g, " ");

function settingsSentence(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail);
  if (keys.length === 1) {
    const [key] = keys;
    const value = detail[key];
    if (key === "theme") return `Switched to the ${cap(String(value))} theme`;
    if (key === "accent") return "Changed the accent colour";
    if (typeof value === "boolean") return `Turned ${value ? "on" : "off"} ${human(key)}`;
    return `Set ${human(key)} to ${String(value)}`;
  }
  if (keys.length === 0) return "Changed settings";
  const named = keys.slice(0, 2).map(human);
  return keys.length > 2 ? `Changed ${named.join(", ")} and ${keys.length - 2} more` : `Changed ${named.join(" and ")}`;
}

/** The sentence for one action; `target` (a file name) is returned separately so it can be emphasised. */
export function describe(entry: ActivityEntry): { text: string; target: string | null; failed: boolean } {
  const d = entry.detail ?? {};
  const target = entry.target ?? null;
  const running = entry.state === "running";
  const sentence = (): [string, boolean] => {
    switch (entry.tool) {
      case "image_trim": return ["Trimmed", true];
      case "image_round_corners": return ["Rounded the corners of", true];
      case "editor_create": return ["Started editing", true];
      case "editor_edit": return ["Edited", true];
      case "editor_render": return ["Exported", true];
      case "open_in_glint": return ["Opened in Glint:", true];
      case "video_open": return ["Opened for editing:", true];
      case "video_edit": return ["Edited", true];
      case "video_captions": return ["Added captions to", true];
      case "video_export": return [running ? "Started exporting" : "Exported", true];
      case "task_cancel": return ["Cancelled a background task", false];
      case "settings_set": return [settingsSentence(d), false];
      case "hotkey_set": {
        const label = SHORTCUTS[String(d.action)] ?? "a";
        return [d.accelerator ? `Set the ${label} shortcut to ${String(d.accelerator)}` : `Cleared the ${label} shortcut`, false];
      }
      case "hotkeys_reset": return ["Reset all shortcuts", false];
      case "show_glint": return [`Opened ${cap(String(d.page ?? "Glint"))}`, false];
      case "capture_screenshot": return [`Took a ${String(d.mode ?? "")} screenshot`.replace("  ", " "), false];
      case "capture_scrolling": return ["Started a scrolling capture", false];
      case "recording_start": return ["Started a recording", false];
      case "recording_stop": return ["Saved a recording", true];
      case "recording_control": return [`${cap(String(d.action ?? "checked"))} the recording`.replace("Status the", "Checked the").replace("Cancel the", "Discarded the").replace("Pause the", "Paused the").replace("Resume the", "Resumed the"), false];
      default: return [cap(entry.tool.replace(/_/g, " ")), true];
    }
  };
  const [text, withTarget] = sentence();
  return { text, target: withTarget ? target : null, failed: !entry.ok };
}

/** "Just now", "4 min ago", "3 h ago", "Yesterday", "12 Nov". */
export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "Just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The status line under an agent's name. */
export function statusOf(agent: AgentStatus, now = Date.now()): { label: string; tone: "live" | "ready" | "off" } {
  if (agent.active) return { label: "Active now", tone: "live" };
  if (agent.last_used) return { label: `Last used ${ago(agent.last_used, now).toLowerCase()}`, tone: "ready" };
  if (agent.configured) return { label: "Connected, not used yet", tone: "ready" };
  return { label: "Not connected", tone: "off" };
}
