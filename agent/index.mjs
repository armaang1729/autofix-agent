#!/usr/bin/env node
/**
 * Autofix agent: reads a GitHub issue, calls the LLM to propose file changes,
 * writes changes to the repo. Run from repo root (e.g. in GitHub Actions after checkout).
 *
 * Env: ISSUE_TITLE, ISSUE_BODY, ISSUE_NUMBER, OPENAI_API_KEY, [OPENAI_BASE_URL]
 * Optional: OPENAI_API_VERSION (for Azure), RUNNER_TEMP.
 */

import fs from 'fs';
import path from 'path';

const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER || '0';
const API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const API_VERSION = process.env.OPENAI_API_VERSION || '';
const IS_AZURE = BASE_URL.includes('openai.azure.com');
const REPO_ROOT = process.env.GITHUB_WORKSPACE || process.cwd();
const OUT_DIR = process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp';

function listRepoFiles(dir, prefix = '', maxFiles = 200) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      files.push(...listRepoFiles(path.join(dir, e.name), rel, maxFiles - files.length));
      if (files.length >= maxFiles) break;
    } else {
      files.push(rel);
      if (files.length >= maxFiles) break;
    }
  }
  return files;
}

function buildPrompt(fileList) {
  return `You are an expert developer. A GitHub issue was opened for this repo. Your job is to produce a minimal fix.

Issue #${ISSUE_NUMBER}
Title: ${ISSUE_TITLE}

Description:
${ISSUE_BODY}

Relevant files in the repo (path only): ${fileList.slice(0, 80).join(', ')}

Respond with a single JSON object and nothing else. No markdown, no code fence.
Use this exact shape:
{
  "skip": false,
  "reason": null,
  "branch": "autofix/issue-${ISSUE_NUMBER}",
  "commitMessage": "Fix: <short description> (#${ISSUE_NUMBER})",
  "changes": [
    { "path": "relative/path/from/repo/root", "content": "full file content as string" }
  ]
}

Rules:
- If you cannot determine a safe fix from the issue alone, set "skip": true and set "reason" to a short message for the user.
- Only include files that need to be changed. "path" must be relative to repo root. Use "content" for the entire new file content.
- commitMessage should reference the issue and be concise.
- Keep changes minimal and match existing code style.`;
}

async function callLLM(prompt) {
  let url = `${BASE_URL.replace(/\/$/, '')}/chat/completions`;
  if (API_VERSION) url += `?api-version=${encodeURIComponent(API_VERSION)}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(IS_AZURE ? { 'api-key': API_KEY } : { 'Authorization': `Bearer ${API_KEY}` }),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: 8192,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM API error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error('Empty LLM response');
  return JSON.parse(raw);
}

function applyChanges(changes) {
  const rootReal = path.resolve(REPO_ROOT);
  for (const { path: filePath, content } of changes) {
    if (!filePath || typeof content !== 'string') continue;
    const full = path.resolve(REPO_ROOT, filePath);
    if (!full.startsWith(rootReal + path.sep) && full !== rootReal) {
      console.warn('Skipping path outside repo:', filePath);
      continue;
    }
    const dir = path.dirname(full);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
}

function writeOutput(branch, commitMessage, skip, reason) {
  const out = path.join(OUT_DIR, 'autofix-output.json');
  fs.writeFileSync(out, JSON.stringify({ branch, commitMessage, skip, reason }), 'utf8');
  console.log('Output written to', out);
}

async function main() {
  if (!API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    process.exit(1);
  }
  if (!ISSUE_TITLE && !ISSUE_BODY) {
    console.error('ISSUE_TITLE and ISSUE_BODY are required');
    process.exit(1);
  }

  const fileList = listRepoFiles(REPO_ROOT);
  const prompt = buildPrompt(fileList);
  console.log('Calling LLM...');
  let result;
  try {
    result = await callLLM(prompt);
  } catch (e) {
    console.error(e);
    writeOutput('', '', true, e.message);
    process.exit(1);
  }

  if (result.skip && result.reason) {
    console.log('Agent skipped:', result.reason);
    writeOutput(result.branch || '', result.commitMessage || '', true, result.reason);
    process.exit(0);
  }

  const changes = result.changes || [];
  if (changes.length === 0) {
    console.log('No changes produced');
    writeOutput(result.branch || '', result.commitMessage || '', true, 'No changes produced');
    process.exit(0);
  }

  applyChanges(changes);
  writeOutput(result.branch || `autofix/issue-${ISSUE_NUMBER}`, result.commitMessage || `Fix (#${ISSUE_NUMBER})`, false, null);
  console.log('Applied', changes.length, 'file(s). Branch:', result.branch);
}

main();
