import { describe, expect, it } from "vitest";
import { agentSetups } from "./mcpSetup";

describe("agent setup snippets", () => {
  it("quotes paths with spaces and launches glint --mcp", () => {
    const setups = agentSetups({ exe: "C:\\Users\\A B\\AppData\\Local\\Glint\\glint.exe", args: ["--mcp"], app_id: null });
    const claude = setups.find((s) => s.id === "claude")!.snippet;
    expect(claude).toBe('claude mcp add --scope user glint -- "C:\\Users\\A B\\AppData\\Local\\Glint\\glint.exe" --mcp');
    expect(setups.find((s) => s.id === "codex")!.snippet).toContain('codex mcp add glint -- "C:\\Users');
    const generic = JSON.parse(setups.find((s) => s.id === "json")!.snippet);
    expect(generic.mcpServers.glint).toEqual({ command: "C:\\Users\\A B\\AppData\\Local\\Glint\\glint.exe", args: ["--mcp"] });
    const opencode = JSON.parse(setups.find((s) => s.id === "opencode")!.snippet);
    expect(opencode.mcp.glint.command).toEqual(["C:\\Users\\A B\\AppData\\Local\\Glint\\glint.exe", "--mcp"]);
  });

  it("passes the app id for preview builds", () => {
    const setups = agentSetups({ exe: "C:\\x\\glint.exe", args: ["--mcp"], app_id: "com.glint.preview" });
    expect(setups[0].snippet).toBe("claude mcp add --scope user glint -e GLINT_APP_ID=com.glint.preview -- C:\\x\\glint.exe --mcp");
    expect(JSON.parse(setups[3].snippet).mcpServers.glint.env).toEqual({ GLINT_APP_ID: "com.glint.preview" });
  });
});
