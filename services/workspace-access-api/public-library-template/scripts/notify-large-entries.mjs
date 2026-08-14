import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const threshold = 200 * 1024 * 1024;
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

async function main() {
  if (!token || !repository) throw new Error('GitHub issue notification requires Actions credentials');
  const entries = [];
  for (const gamePreset of await directories(path.join(root, 'games'))) {
    for (const entryId of await directories(path.join(root, 'games', gamePreset, 'entries'))) {
      const metadata = await readJson(path.join(root, 'games', gamePreset, 'entries', entryId, 'metadata.json'));
      if (metadata.fullData?.available === true && metadata.fullData.size > threshold) entries.push({ gamePreset, entryId, metadata });
    }
  }
  const openIssues = await github(`/repos/${repository}/issues?state=open&per_page=100`);
  for (const item of entries) {
    const title = `[workspace-review] ${item.entryId}`;
    if (openIssues.some((issue) => issue.title === title && !issue.pull_request)) continue;
    const attribution = item.metadata.attribution?.mode === 'custom' ? item.metadata.attribution.displayName : 'anonymous';
    await github(`/repos/${repository}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title,
        body: [
          'A complete workspace package exceeded the automatic review threshold.',
          '',
          `- Entry ID: ${item.entryId}`,
          `- Game: ${item.gamePreset}`,
          `- Workspace: ${item.metadata.workspaceName}`,
          `- Attribution: ${attribution} (self-asserted; not verified)`,
          `- Size: ${item.metadata.fullData.size} bytes`,
          `- SHA-256: ${item.metadata.fullData.sha256}`,
          `- Metadata: /games/${item.gamePreset}/entries/${item.entryId}/metadata.json`,
        ].join('\n'),
      }),
    });
  }
}

async function github(endpoint, init = {}) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    ...init,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'ssmt-workspace-library-action', ...(init.headers || {}) },
  });
  if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
  return response.json();
}

async function directories(directory) {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
