# Connect a coding agent to Glint

Glint includes an MCP server, so a coding agent can use Glint for you. It can:

- trim and round images, and annotate screenshots;
- edit and export recordings: cuts, zooms, captions;
- take screenshots and recordings;
- change settings, themes and hotkeys.

The server is part of Glint itself (`glint.exe --mcp`), so there is nothing extra to install. If Glint isn't running, it starts quietly in the tray.

**How to use this page.** Find your agent below. Run its line in **PowerShell**, or add the config it shows, then restart the agent. In Glint, **Settings → Agents** then shows it as connected, with a log of what it did.

> The commands use `$env:LOCALAPPDATA\Glint\glint.exe`, which is where the standard installer puts Glint for every Windows user. If you installed the **MSI**, use `$env:ProgramFiles\Glint\glint.exe` instead. Keep the quotes around `'--'`: PowerShell swallows a bare `--`.

## Claude Code

```powershell
claude mcp add --scope user glint '--' "$env:LOCALAPPDATA\Glint\glint.exe" --mcp
```

## Codex

```powershell
codex mcp add glint '--' "$env:LOCALAPPDATA\Glint\glint.exe" --mcp
```

## OpenCode

```powershell
opencode mcp add glint --global '--' "$env:LOCALAPPDATA\Glint\glint.exe" --mcp
```

## Antigravity

```powershell
agy mcp add glint "$env:LOCALAPPDATA\Glint\glint.exe" --mcp
```

## GitHub Copilot CLI

Run `/mcp add` inside Copilot CLI and enter the command below, or add it to `%USERPROFILE%\.copilot\mcp-config.json`:

```json
{
  "mcpServers": {
    "glint": {
      "type": "local",
      "command": "C:\\Users\\<you>\\AppData\\Local\\Glint\\glint.exe",
      "args": ["--mcp"],
      "tools": ["*"]
    }
  }
}
```

## Cursor

Add to `%USERPROFILE%\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "glint": {
      "command": "C:\\Users\\<you>\\AppData\\Local\\Glint\\glint.exe",
      "args": ["--mcp"]
    }
  }
}
```

## Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "glint": {
      "command": "C:\\Users\\<you>\\AppData\\Local\\Glint\\glint.exe",
      "args": ["--mcp"]
    }
  }
}
```

## Oh My Pi

Add Glint as a local (stdio) MCP server in Oh My Pi's MCP settings, with this command and argument:

- **Command:** `C:\Users\<you>\AppData\Local\Glint\glint.exe`
- **Arguments:** `--mcp`

## Pi

Pi doesn't include MCP by design. Install an MCP adapter extension into `%USERPROFILE%\.pi\agent\extensions`, then point it at the same command and `--mcp` argument as Oh My Pi above.

## Grok Build

Add Glint as a local (stdio) MCP server in Grok Build's MCP settings, with the same command and `--mcp` argument as Oh My Pi above.

## Any other MCP client

Glint works with any client that can launch a local (stdio) MCP server. Use the command `glint.exe` from your Glint install folder with the argument `--mcp`. The client then appears in **Settings → Agents** under its own name.

> In the JSON examples, replace `<you>` with your Windows user name. JSON needs every backslash doubled.

## Privacy

Everything stays on your PC:

- The agent talks to Glint over a local pipe that refuses network connections.
- The activity log in Settings → Agents keeps only the action and the file *name*, never file contents, and is capped in size.
- Agents never overwrite your originals: edits and exports are saved as new files.
