# Project constitution (AI-first)

This document codifies how this repo is developed and how the autofix agent should behave.

## Autofix flow

1. **Trigger**: A GitHub issue is opened (and optionally labeled `autofix`).
2. **Analysis**: The agent reads the issue and, if needed, relevant parts of the codebase.
3. **Solution**: The agent produces a minimal set of file changes.
4. **Delivery**: A branch is created, changes are committed, and a PR is opened linking the issue.

## Principles

- **Minimal edits**: Prefer the smallest change that fixes the issue or implements the request.
- **Consistency**: Match existing code style, structure, and patterns.
- **Safe by default**: Do not refactor unrelated code or add features not requested in the issue.
- **Transparency**: If the agent cannot fix an issue from the given context, it should say so (e.g., via a comment on the issue) rather than guess.

## Tech and tooling

- The autofix pipeline runs in GitHub Actions.
- It uses an LLM (e.g., OpenAI) to generate edits; see README for required secrets.
- Optional: Cursor rules (`.cursor/rules/`) and MCP servers improve local and AI-assisted development.

This constitution is a living document; update it as the project evolves.
