/** Setup snippets that connect coding agents to this install's Glint MCP. */
export interface McpLaunch {
  exe: string;
  args: string[];
  /** Set for non-default builds (previews), so the server talks to the right app. */
  app_id: string | null;
}

export interface AgentSetup {
  id: "claude" | "codex" | "opencode" | "json";
  name: string;
  /** Where the snippet goes. */
  where: string;
  snippet: string;
}

const quote = (path: string) => (/[\s"]/.test(path) ? `"${path.replace(/"/g, '\\"')}"` : path);

export function agentSetups(launch: McpLaunch): AgentSetup[] {
  const command = [quote(launch.exe), ...launch.args].join(" ");
  const env = launch.app_id ? { GLINT_APP_ID: launch.app_id } : null;
  const claudeEnv = env ? ` -e GLINT_APP_ID=${launch.app_id}` : "";
  const codexEnv = env ? ` --env GLINT_APP_ID=${launch.app_id}` : "";
  const opencode = {
    $schema: "https://opencode.ai/config.json",
    mcp: { glint: { type: "local", command: [launch.exe, ...launch.args], enabled: true, ...(env ? { environment: env } : {}) } },
  };
  const generic = { mcpServers: { glint: { command: launch.exe, args: launch.args, ...(env ? { env } : {}) } } };
  return [
    { id: "claude", name: "Claude Code", where: "Terminal", snippet: `claude mcp add --scope user glint${claudeEnv} -- ${command}` },
    { id: "codex", name: "Codex", where: "Terminal", snippet: `codex mcp add glint${codexEnv} -- ${command}` },
    { id: "opencode", name: "OpenCode", where: "opencode.json", snippet: JSON.stringify(opencode, null, 2) },
    { id: "json", name: "Other MCP clients", where: "MCP config (Cursor, Claude Desktop…)", snippet: JSON.stringify(generic, null, 2) },
  ];
}
