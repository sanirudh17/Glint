//! `glint-mcp` — Glint's MCP server for coding agents, over stdio.
//! Agents launch it themselves (e.g. `claude mcp add glint -- glint-mcp.exe`).
//! It never starts Glint's UI; see `glint_lib::mcp`.
fn main() {
    if let Err(error) = glint_lib::mcp::run_stdio() {
        // stdout carries the protocol; diagnostics go to stderr only.
        eprintln!("glint-mcp: {error}");
        std::process::exit(1);
    }
}
