/**
 * Settings → Agents. Which coding agents are connected to Glint, and what they
 * did here. Setup lives in the README (Setup guide); this page shows state, so
 * it stays useful whether or not anything is connected yet.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowUpRight, Terminal } from "../../icons";
import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { ago, describe, statusOf, type AgentsOverview, type AgentStatus } from "../../lib/agentActivity";
import claudeCode from "../../assets/agents/claude-code.svg";
import codex from "../../assets/agents/codex.svg";
import opencode from "../../assets/agents/opencode.svg";
import cursor from "../../assets/agents/cursor.svg";
import claudeDesktop from "../../assets/agents/claude-desktop.svg";

const LOGOS: Record<string, { src: string; ink?: boolean }> = {
  "claude-code": { src: claudeCode },
  codex: { src: codex, ink: true },
  opencode: { src: opencode, ink: true },
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

  const openGuide = () => invoke("agents_open_guide").catch(() => pushToast("Couldn't open the setup guide"));
  const shown: AgentStatus[] = (view?.agents ?? []).filter((a) => a.installed || a.configured || a.last_used);
  const anyConnected = shown.some((a) => a.configured || a.active);
  const guide = (
    <button type="button" className="agents-guide" onClick={() => void openGuide()}>
      <span>Setup guide</span>
      <ArrowUpRight size={13} strokeWidth={1.75} />
    </button>
  );

  if (view && !anyConnected && view.activity.length === 0) {
    return (
      <Section title="Agents">
        <div className="agents-empty">
          <div className="agents-empty-logos" aria-hidden>
            {["claude-code", "codex", "opencode"].map((id) => <Logo key={id} id={id} size="md" />)}
          </div>
          <p className="agents-empty-title">No coding agents connected</p>
          <p className="agents-empty-text">Connect Claude Code, Codex or OpenCode to let them edit, capture and change settings in Glint.</p>
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
        <h3 className="agents-subtitle">Connected agents</h3>
        {guide}
      </div>
      <Card>
        <ul className="agents-list" role="list">
          {shown.map((agent) => {
            const status = statusOf(agent);
            return (
              <li className="agents-row" key={agent.id}>
                <Logo id={agent.id} size="md" />
                <span className="agents-name">{agent.name}</span>
                <span className={`agents-status agents-status--${status.tone}`}>
                  {status.tone === "live" && <span className="agents-live-dot" aria-hidden />}
                  {status.label}
                </span>
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
              const name = shown.find((a) => a.id === entry.agent)?.name ?? entry.client;
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
