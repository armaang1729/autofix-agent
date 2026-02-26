# autofix-agent

This repo is **AI-first**: when an issue is logged, an agent analyzes it, proposes a fix, and opens a PR automatically.

## How it works

### Autofix (Issue → PR)

1. **Trigger** – A GitHub issue is opened (or labeled `autofix`).
2. **Analysis** – The agent reads the issue and the repo file list, then calls an LLM to propose minimal file changes.
3. **Solution** – The agent writes the suggested changes to the repo.
4. **Delivery** – A branch is created, changes are committed and pushed, and a PR is opened that references the issue.

If the agent cannot produce a safe fix (e.g. not enough context), it comments on the issue instead of opening a PR.

### Auto-Review (PR → Review Comments)

1. **Trigger** – A PR is opened, updated, or reopened (any PR, whether created by autofix or humans).
2. **Analysis** – The review agent fetches the PR diff and sends it to the LLM for analysis.
3. **Review** – The agent posts a comment with suggestions for improvements, covering:
   - Code quality and best practices
   - Potential bugs or edge cases
   - Security concerns
   - Performance implications
   - Readability and maintainability
4. **Updates** – If new commits are pushed to the PR, the review is updated automatically.

---

## What you need to run the autofix pipeline

### 1. GitHub repository

- Repo on GitHub (or GitHub Enterprise).
- Default branch `main` (or change `base: 'main'` in `.github/workflows/autofix-on-issue.yml`).

**If you see "GitHub Actions is not permitted to create or approve pull requests":**

- **Option A:** In the repo go to **Settings → Actions → General**. Under "Workflow permissions", select **Read and write permissions** and check **Allow GitHub Actions to create and approve pull requests**. Save.
- **Option B:** Use a Personal Access Token (PAT) with `repo` scope. Create a secret named **AUTOFIX_GITHUB_TOKEN** with the PAT value. The workflow will use it for pushing and creating PRs when present. If you get **404 Not Found** when creating the PR: use a **classic** PAT with **repo** scope; if the repo is in an org with SSO, go to the token in GitHub → **Configure SSO** and authorize it for that org.

### 2. LLM API (required for the agent)

The workflow uses an OpenAI-compatible API to generate fixes.

| What | Description |
|------|-------------|
| **OPENAI_API_KEY** | **Required.** Create a secret in the repo: **Settings → Secrets and variables → Actions → New repository secret.** Name it `OPENAI_API_KEY` and set it to your API key (e.g. from [OpenAI](https://platform.openai.com/api-keys) or any compatible provider). |
| **OPENAI_BASE_URL** | Optional. Use if your LLM is not OpenAI (e.g. Azure OpenAI, local proxy). Set the base URL (e.g. `https://api.openai.com/v1` or your proxy). |
| **OPENAI_API_VERSION** | Optional. For **Azure OpenAI** set this to the API version (e.g. `2024-02-15-preview` or `2024-08-01-preview`). |
| **OPENAI_MODEL** | Optional. Model name (default: `gpt-4o-mini`). For Azure, use your deployment name (e.g. `gpt-4o`) if the API expects it. |

#### Using Azure OpenAI

Add these repository secrets:

| Secret | Value |
|--------|--------|
| **OPENAI_API_KEY** | Your Azure OpenAI API key (from Azure Portal → your resource → Keys and Endpoint). |
| **OPENAI_BASE_URL** | `https://<your-resource-name>.openai.azure.com/openai/deployments/<your-deployment-name>` (no trailing slash). |
| **OPENAI_API_VERSION** | e.g. `2024-02-15-preview` or `2024-08-01-preview`. |
| **OPENAI_MODEL** | Your deployment name (e.g. `gpt-4o`), if needed by your deployment. |

The agent detects Azure when the base URL contains `openai.azure.com` and uses the `api-key` header automatically.

### 3. MCP and other tools (optional)

These are **not** required for the automatic issue → PR flow, but they improve local and AI-assisted development (e.g. in Cursor):

| Tool | Purpose |
|------|---------|
| **Cursor rules** | Already in `.cursor/rules/`. They guide the AI when you (or the agent) work in this repo. |
| **MCP servers** | Optional. For example: **GitHub MCP** (repo/PR/issue context), **Jira MCP** (if you use Jira), or **codebase/search MCP** for richer context. Install via [Easy MCP](https://wiki.corp.adobe.com/display/WEM/Easy+MCP+Installation) or your IDE’s MCP support. |
| **Spec / constitution** | `.specify/memory/constitution.md` and optional `spec/` folder describe principles and patterns so the agent stays consistent. |

No MCP is required for the GitHub Actions autofix; the agent runs in the workflow with only the issue body and repo file list.

---

## Working with AI in this repo

- The codebase is set up to work with **Cursor**. Rules live in `.cursor/rules/` (e.g. AI-first behavior, code standards).
- For **autofix**: write clear issues (steps to reproduce, expected vs actual, file paths or snippets). Optionally add the `autofix` label if you only want the agent to run on labeled issues (see below).
- **Review every autofix PR** before merging; the agent can make mistakes.

### Run autofix only when issue has a label

By default, the workflow runs on **every** new issue. To run only when an issue has the `autofix` label, change the trigger and job condition:

In `.github/workflows/autofix-on-issue.yml`:

- Keep `on.issues.types: [labeled]` and remove `opened`, **or**
- Keep both but change the job `if` to run only when the issue has the `autofix` label:

```yaml
if: (github.event.action == 'labeled' && contains(github.event.label.name, 'autofix')) || (github.event.action == 'opened' && contains(github.event.issue.labels.*.name, 'autofix'))
```

(Note: on `opened`, labels are often empty; so “only when labeled” is usually done by triggering on `labeled` only.)

---

## Development

- **Autofix agent**: `agent/index.mjs` – runs in GitHub Actions, reads env (issue, API key), calls the LLM, writes file changes and metadata.
- **Review agent**: `agent/review.mjs` – analyzes PR diffs and generates review suggestions.
- **Autofix workflow**: `.github/workflows/autofix-on-issue.yml` – checkout, run agent, commit, push, open PR or comment on issue.
- **Review workflow**: `.github/workflows/review-pr.yml` – fetches PR diff, runs review agent, posts review comment.
- **Constitution**: `.specify/memory/constitution.md` – high-level principles for the agent and contributors.

To test the agent locally (Node 18+):

```bash
export OPENAI_API_KEY=your_key
export ISSUE_TITLE="Fix typo in README"
export ISSUE_BODY="The word 'teh' should be 'the'."
export ISSUE_NUMBER=1
node agent/index.mjs
```

Then check the repo for applied changes and `$TMPDIR/autofix-output.json` for branch and commit message.

---

## Before you push

- **Never commit `.env`** — it is in `.gitignore`; keep API keys only in GitHub **Settings → Secrets and variables → Actions**.
- For **Azure OpenAI**, set the **OPENAI_BASE_URL** secret to the full URL including the deployment path:  
  `https://<resource>.openai.azure.com/openai/deployments/<deployment-name>` (no trailing slash).

---

## Reference

This setup is inspired by AI-first and spec-driven practices similar to [Project Success Studio UI](https://github.com/OneAdobe/experience-success-studio-ui): Cursor rules, optional MCP, and a project constitution for consistent, AI-assisted development.
