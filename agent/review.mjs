#!/usr/bin/env node
/**
 * PR Review agent: fetches PR diff, calls the LLM to analyze changes,
 * and posts review comments with suggestions for improvements.
 *
 * Env: PR_NUMBER, PR_DIFF, REPO, OPENAI_API_KEY, [OPENAI_BASE_URL], GH_TOKEN
 * Optional: OPENAI_API_VERSION (for Azure), OPENAI_MODEL.
 */

import fs from 'fs';
import path from 'path';

const PR_NUMBER = process.env.PR_NUMBER || '0';
const PR_TITLE = process.env.PR_TITLE || '';
const PR_BODY = process.env.PR_BODY || '';
const PR_DIFF = process.env.PR_DIFF || '';
const REPO = process.env.REPO || '';
const API_KEY = process.env.OPENAI_API_KEY;
const GH_TOKEN = process.env.GH_TOKEN;
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const API_VERSION = process.env.OPENAI_API_VERSION || '';
const IS_AZURE = BASE_URL.includes('openai.azure.com');
const OUT_DIR = process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp';

function buildPrompt(diff) {
  return `You are an expert code reviewer. A pull request has been opened and you need to review it.

PR #${PR_NUMBER}
Title: ${PR_TITLE}

Description:
${PR_BODY || '(No description provided)'}

Diff:
\`\`\`diff
${diff.slice(0, 15000)}
\`\`\`

Analyze the changes and provide a constructive code review. Focus on:
1. Code quality and best practices
2. Potential bugs or edge cases
3. Security concerns
4. Performance implications
5. Readability and maintainability
6. Missing tests or documentation (if applicable)

Respond with a single JSON object and nothing else. No markdown, no code fence.
Use this exact shape:
{
  "summary": "A brief 1-2 sentence overall assessment",
  "suggestions": [
    {
      "file": "path/to/file.js",
      "line": 42,
      "severity": "suggestion|warning|critical",
      "message": "Description of what could be improved and why",
      "suggestedCode": "Optional: improved code snippet if applicable"
    }
  ],
  "approved": true or false (true if changes look good overall, false if critical issues found)
}

Rules:
- Be constructive and helpful, not nitpicky
- Only include meaningful suggestions that add value
- If the PR looks good, return an empty suggestions array and approved: true
- Use "critical" severity sparingly, only for bugs or security issues
- "warning" for potential issues or anti-patterns
- "suggestion" for style improvements or minor enhancements
- Line numbers should reference the new file line (after changes), use 0 if not applicable to a specific line
- Keep suggestions concise but actionable`;
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
      max_tokens: 4096,
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

function formatReviewBody(result) {
  let body = `## 🤖 AI Code Review\n\n`;
  body += `**Summary:** ${result.summary}\n\n`;

  if (result.suggestions && result.suggestions.length > 0) {
    body += `### Suggestions\n\n`;
    for (const s of result.suggestions) {
      const icon = s.severity === 'critical' ? '🔴' : s.severity === 'warning' ? '🟡' : '💡';
      body += `${icon} **${s.file}**`;
      if (s.line > 0) body += ` (line ${s.line})`;
      body += `\n\n${s.message}\n\n`;
      if (s.suggestedCode) {
        body += `\`\`\`suggestion\n${s.suggestedCode}\n\`\`\`\n\n`;
      }
    }
  } else {
    body += `✅ No issues found. The changes look good!\n\n`;
  }

  body += `---\n*This review was generated automatically by the AI review agent.*`;
  return body;
}

function writeOutput(review, body, approved) {
  const out = path.join(OUT_DIR, 'review-output.json');
  fs.writeFileSync(out, JSON.stringify({ review, body, approved }), 'utf8');
  console.log('Output written to', out);
}

async function main() {
  if (!API_KEY) {
    console.error('OPENAI_API_KEY is not set');
    process.exit(1);
  }
  if (!PR_DIFF) {
    console.error('PR_DIFF is empty - no changes to review');
    process.exit(0);
  }

  console.log(`Reviewing PR #${PR_NUMBER}...`);
  const prompt = buildPrompt(PR_DIFF);

  let result;
  try {
    result = await callLLM(prompt);
  } catch (e) {
    console.error('LLM call failed:', e);
    process.exit(1);
  }

  const body = formatReviewBody(result);
  const approved = result.approved !== false;

  writeOutput(result, body, approved);
  console.log('Review complete. Approved:', approved);
  console.log('Suggestions:', result.suggestions?.length || 0);
}

main();
