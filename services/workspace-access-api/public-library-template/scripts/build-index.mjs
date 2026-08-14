import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const gamesRoot = path.join(root, 'games');
const indexRoot = path.join(root, 'index', 'v1');
const generatedAt = new Date().toISOString();

async function main() {
  const games = await listDirectories(gamesRoot);
  const all = [];
  for (const gamePreset of games.sort()) {
    const entriesRoot = path.join(gamesRoot, gamePreset, 'entries');
    const entries = [];
    for (const entryId of (await listDirectories(entriesRoot)).sort()) {
      const metadataPath = path.join(entriesRoot, entryId, 'metadata.json');
      const statusPath = path.join(entriesRoot, entryId, 'status.json');
      const metadata = await readJson(metadataPath);
      const status = await readJson(statusPath);
      if (metadata.entryId !== entryId || metadata.gamePreset !== gamePreset || status.entryId !== entryId) {
        throw new Error(`entry identity mismatch: ${gamePreset}/${entryId}`);
      }
      const drawIB = metadata.lods.flatMap((lod) => lod.drawIB.map((item) => item.hash));
      const aliases = [...(metadata.workspaceAliases || []), ...metadata.lods.flatMap((lod) => [...lod.drawIB, ...lod.skipIB, ...lod.vsCheck].map((item) => item.alias).filter(Boolean))];
      const attribution = metadata.attribution?.mode === 'custom' ? metadata.attribution.displayName : 'anonymous';
      const item = {
        entryId,
        workspaceName: metadata.workspaceName,
        description: metadata.description ?? null,
        attribution,
        attributionVerified: false,
        uploadedAt: metadata.uploadedAt,
        capturedAt: metadata.capturedAt ?? null,
        drawIB: [...new Set(drawIB)].sort(),
        aliases: [...new Set(aliases)].sort(),
        fullDataAvailable: metadata.fullData?.available === true,
        fullDataSize: metadata.fullData?.available === true ? metadata.fullData.size : 0,
        availability: status.availability,
        reviewState: status.moderation?.reviewState || 'not_required',
        metadataPath: `games/${gamePreset}/entries/${entryId}/metadata.json`,
      };
      entries.push(item);
      all.push({ ...item, gamePreset });
    }
    entries.sort(sortNewest);
    await writeJson(path.join(indexRoot, `${gamePreset}.json`), { schemaVersion: 1, gamePreset, generatedAt, entries });
  }
  all.sort(sortNewest);
  await writeJson(path.join(indexRoot, 'all.json'), { schemaVersion: 1, gamePreset: 'all', generatedAt, entries: all });
}

function sortNewest(left, right) { return right.uploadedAt.localeCompare(left.uploadedAt) || left.entryId.localeCompare(right.entryId); }
async function listDirectories(directory) {
  try { return (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
