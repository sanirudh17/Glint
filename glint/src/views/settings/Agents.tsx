/**
 * Settings → Agents. Connect coding agents (Claude Code, Codex, OpenCode, any MCP
 * client) to Glint: one row per agent, each copying the exact setup for this
 * install (`glint.exe --mcp`).
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check } from "../../icons";
import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { agentSetups, type AgentSetup, type McpLaunch } from "../../lib/mcpSetup";

export function Agents() {
  const pushToast = useAppStore((s) => s.pushToast);
  const [setups, setSetups] = useState<AgentSetup[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    invoke<McpLaunch>("mcp_setup").then((launch) => setSetups(agentSetups(launch))).catch(() => setSetups([]));
  }, []);

  async function copy(setup: AgentSetup) {
    try {
      await navigator.clipboard.writeText(setup.snippet);
      setCopied(setup.id);
      pushToast(`${setup.name} setup copied`);
      window.setTimeout(() => setCopied((c) => (c === setup.id ? null : c)), 1600);
    } catch {
      pushToast("Couldn't copy to the clipboard");
    }
  }

  return (
    <Section title="Agents">
      <Card>
        <div className="settings-agents-list">
          {(setups ?? []).map((setup) => (
            <div className="settings-agents-row" key={setup.id}>
              <div className="settings-agents-meta">
                <span className="settings-agents-name">{setup.name}</span>
                <span className="settings-agents-where">{setup.where}</span>
              </div>
              <button type="button" className="settings-hotkey-btn" onClick={() => void copy(setup)} aria-label={`Copy ${setup.name} setup`}>
                {copied === setup.id ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.5} />}
                <span>{copied === setup.id ? "Copied" : "Copy setup"}</span>
              </button>
              <code className="settings-agents-snippet">{setup.snippet}</code>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  );
}
