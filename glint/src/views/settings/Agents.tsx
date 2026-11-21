/**
 * Settings → Agents. The coding agents installed on this PC, whether each is
 * connected to Glint, and what they did here. Agents that aren't installed sit
 * behind "Set up another agent"; setup steps live in the README.
 */
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, ChevronDown, Terminal } from "../../icons";
import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { ago, describe, statusOf, type AgentsOverview, type AgentStatus } from "../../lib/agentActivity";
import claudeCode from "../../assets/agents/claude-code.svg";
import codex from "../../assets/agents/codex.svg";
import opencode from "../../assets/agents/opencode.svg";
import antigravity from "../../assets/agents/antigravity.svg";
import copilot from "../../assets/agents/copilot.svg";
import grok from "../../assets/agents/grok.svg";
import cursor from "../../assets/agents/cursor.svg";
import claudeDesktop from "../../assets/agents/claude-desktop.svg";

/** Real marks (CC0 drawings). `ink` marks are black and invert in the dark theme. */
const LOGOS: Record<string, { src: string; ink?: boolean }> = {
  "claude-code": { src: claudeCode },
  codex: { src: codex, ink: true },
  opencode: { src: opencode, ink: true },
  antigravity: { src: antigravity },
  copilot: { src: copilot, ink: true },
  grok: { src: grok, ink: true },
  cursor: { src: cursor, ink: true },
  "claude-desktop": { src: claudeDesktop },
};
const REFRESH_MS = 2500;

function Logo({ id, size }: { id: string; size: "md" | "sm" }) {
  const logo = LOGOS[id];
  return (
    <span className={`agents-logo agents-logo--${size}`} aria-hidden>
      {logo ? <img src={logo.src} alt="" className={logo.ink ? "agents-logo-ink" : undefined} /> : <Terminal size={size === "md" ? 16 : 12} strokeWidth={1.75} />}
    </span>
  );
}

/** "Set up another agent" — the agents that aren't on this PC, each opening its setup steps. */
function SetupMenu({ agents, onPick }: { agents: AgentStatus[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!agents.length) return null;
  return (
    <div className="agents-menu" ref={ref}>
      <button type="button" className="agents-guide" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Set up another agent</span>
        <ChevronDown size={13} strokeWidth={1.75} className={open ? "agents-chevron agents-chevron--open" : "agents-chevron"} />
      </button>
      {open && (
        <div className="agents-menu-list g-select-dropdown" role="menu">
          {agents.map((a) => (
            <button key={a.id} type="button" role="menuitem" className="agents-menu-item" onClick={() => { setOpen(false); onPick(a.id); }}>
              <Logo id={a.id} size="sm" />
              <span className="agents-menu-name">{a.name}</span>
              <ArrowUpRight size={12} strokeWidth={1.75} className="agents-menu-go" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Agents() {
  const pushToast = useAppStore((s) => s.pushToast);
  const [view, setView] = useState<AgentsOverview | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => invoke<AgentsOverview>("agents_overview").then((v) => alive && setView(v)).catch(() => alive && setView({ agents: [], activity: [] }));
    void load();
    const timer = window.setInterval(() => { void load(); setTick((t) => t + 1); }, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", load); };
  }, []);

  const openGuide = (agent?: string) => invoke("agents_open_guide", { agent: agent ?? null }).catch(() => pushToast("Couldn't open the setup guide"));
  const all = view?.agents ?? [];
  const installed = all.filter((a) => a.installed);
  const others = all.filter((a) => !a.installed && !a.id.startsWith("client:"));
  const nameOf = (id: string, fallback: string) => all.find((a) => a.id === id)?.name ?? fallback;

  if (view && installed.length === 0 && view.activity.length === 0) {
    return (
      <Section title="Agents">
        <div className="agents-empty">
          <div className="agents-empty-logos" aria-hidden>
            {["claude-code", "codex", "opencode"].map((id) => <Logo key={id} id={id} size="md" />)}
          </div>
          <p className="agents-empty-title">No coding agents found</p>
          <p className="agents-empty-text">Install an agent such as Claude Code, Codex or OpenCode, then connect it to let it edit, capture and change settings in Glint.</p>
          <button type="button" className="settings-hotkey-btn agents-empty-action" onClick={() => void openGuide()}>
            <span>Setup guide</span>
            <ArrowUpRight size={13} strokeWidth={1.75} />
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Agents">
      <div className="agents-head">
        <h3 className="agents-subtitle">Your agents</h3>
        <SetupMenu agents={others} onPick={(id) => void openGuide(id)} />
      </div>
      <Card>
        <ul className="agents-list" role="list">
          {installed.map((agent) => {
            const status = statusOf(agent);
            return (
              <li className="agents-row" key={agent.id}>
                <Logo id={agent.id} size="md" />
                <span className="agents-name">{agent.name}</span>
                {status.tone === "off" && !agent.id.startsWith("client:") ? (
                  <button type="button" className="agents-connect" onClick={() => void openGuide(agent.id)}>
                    <span>Connect</span>
                    <ArrowUpRight size={12} strokeWidth={1.75} />
                  </button>
                ) : (
                  <span className={`agents-status agents-status--${status.tone}`}>
                    {status.tone === "live" && <span className="agents-live-dot" aria-hidden />}
                    {status.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <h3 className="agents-subtitle agents-subtitle--spaced">Recent activity</h3>
      <Card>
        {view && view.activity.length > 0 ? (
          <ul className="agents-activity" role="list">
            {view.activity.map((entry) => {
              const { text, target, failed } = describe(entry);
              const name = nameOf(entry.agent, entry.client);
              return (
                <li className="agents-event" key={`${entry.t}-${entry.tool}`}>
                  <Logo id={entry.agent} size="sm" />
                  <span className="agents-event-text" title={`${name}: ${text}${target ? ` ${target}` : ""}`}>
                    {text}
                    {target && <> <span className="agents-event-target">{target}</span></>}
                    {failed && <span className="agents-event-failed">Failed</span>}
                  </span>
                  <time className="agents-event-time" dateTime={new Date(entry.t).toISOString()}>{ago(entry.t)}</time>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="agents-quiet">Nothing yet. Actions agents take in Glint appear here.</p>
        )}
      </Card>
    </Section>
  );
}
