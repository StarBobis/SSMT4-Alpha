import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(process.argv[2] || '.');
const gamesRoot = path.join(root, 'games');
const entryPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function main() {
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const metadataSchema = await json(path.join(root, 'schema', 'v1', 'metadata.schema.json'));
  const statusSchema = await json(path.join(root, 'schema', 'v1', 'status.schema.json'));
  const indexSchema = await json(path.join(root, 'schema', 'v1', 'index.schema.json'));
  const validateMetadata = ajv.compile(metadataSchema);
  const validateStatus = ajv.compile(statusSchema);
  const validateIndex = ajv.compile(indexSchema);
  for (const game of await directories(gamesRoot)) {
    for (const entryId of await directories(path.join(gamesRoot, game, 'entries'))) {
      if (!entryPattern.test(entryId)) throw new Error(`invalid entry id: ${game}/${entryId}`);
      const dir = path.join(gamesRoot, game, 'entries', entryId);
      const metadata = await json(path.join(dir, 'metadata.json'));
      const status = await json(path.join(dir, 'status.json'));
      if (metadata.schemaVersion !== 1 || metadata.entryId !== entryId || metadata.gamePreset !== game) throw new Error(`invalid metadata identity: ${game}/${entryId}`);
      if (status.schemaVersion !== 1 || status.entryId !== entryId) throw new Error(`invalid status identity: ${game}/${entryId}`);
      if (!validateMetadata(metadata)) throw new Error(`metadata schema error: ${game}/${entryId}: ${ajv.errorsText(validateMetadata.errors)}`);
      if (!validateStatus(status)) throw new Error(`status schema error: ${game}/${entryId}: ${ajv.errorsText(validateStatus.errors)}`);
    }
  }
  for (const file of (await files(path.join(root, 'index', 'v1'))).filter((file) => file.endsWith('.json'))) {
    const index = await json(path.join(root, 'index', 'v1', file));
    if (!validateIndex(index)) throw new Error(`index schema error: ${file}: ${ajv.errorsText(validateIndex.errors)}`);
  }
}
async function directories(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function files(dir) { try { return (await fs.readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort(); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function json(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
