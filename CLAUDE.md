# Skills

## Handoff

Compacts the current conversation into a handoff document for another agent to pick up.

**Trigger:** When the user wants to end a session and transfer context to a new agent.

**Arguments:**
- `What will the next session be used for?` (optional) - Description of the next session's focus

**Behavior:**
1. Write a handoff document summarising the current conversation so a fresh agent can continue the work
2. Save to the temporary directory of the user's OS - not the current workspace
3. Include a "suggested skills" section in the document, which suggests skills that the agent should invoke
4. Do not duplicate content already captured in other artifacts (PRDs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead
5. Redact any sensitive information, such as API keys, passwords, or personally identifiable information
6. If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly
