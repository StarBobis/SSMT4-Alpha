import test from 'node:test';
import assert from 'node:assert/strict';
import { attachServerEntryId, createStatus, createUuidV7, normalizeMetadata } from '../src/core.js';

const draft = {
  schemaVersion: 1,
  gamePreset: 'SRMI',
  workspaceName: 'Test',
  attribution: { mode: 'custom', displayName: 'self supplied' },
  lods: [{ name: 'LOD0', drawIB: [{ hash: '0F8A6711', alias: 'Face' }], skipIB: [], vsCheck: [] }],
  fullData: { available: false },
};

test('normalizes metadata and never trusts client timestamps', () => {
  const result = normalizeMetadata(draft, '2026-08-14T00:00:00.000Z');
  assert.equal(result.value.uploadedAt, '2026-08-14T00:00:00.000Z');
  assert.equal(result.value.lods[0].drawIB[0].hash, '0f8a6711');
  assert.equal(result.value.attribution.mode, 'custom');
});

test('rejects unsupported presets and unsafe names', () => {
  assert.equal(normalizeMetadata({ ...draft, gamePreset: 'unknown' }, new Date().toISOString()).error, 'UNSUPPORTED_GAME_PRESET');
  assert.equal(normalizeMetadata({ ...draft, workspaceName: 'bad\u0000name' }, new Date().toISOString()).error, 'INVALID_WORKSPACE_NAME');
});

test('rejects malformed portable timestamps, attribution, and supersedes references', () => {
  const now = '2026-08-14T00:00:00.000Z';
  assert.equal(normalizeMetadata({ ...draft, capturedAt: 'not-a-time' }, now).error, 'INVALID_METADATA');
  assert.equal(normalizeMetadata({ ...draft, attribution: { mode: 'custom' } }, now).error, 'INVALID_METADATA');
  assert.equal(normalizeMetadata({ ...draft, supersedes: 'not-a-uuid' }, now).error, 'INVALID_METADATA');
  const result = normalizeMetadata({ ...draft, capturedAt: '2026-08-14T01:02:03+08:00', supersedes: '0191f000-0000-7000-8000-000000000000' }, now);
  assert.equal(result.value.capturedAt, '2026-08-13T17:02:03.000Z');
  assert.equal(result.value.supersedes, '0191f000-0000-7000-8000-000000000000');
});

test('creates server UUIDv7 and review status', () => {
  const entryId = createUuidV7(1723593600000);
  assert.match(entryId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  const metadata = normalizeMetadata({ ...draft, fullData: { available: true, sha256: 'a'.repeat(64), size: 209715201, uncompressedSize: 1, fileCount: 1 } }, new Date().toISOString()).value;
  assert.equal(createStatus(entryId, metadata).moderation.reviewRequired, true);
});

test('metadata normalization leaves the server-owned entry ID out of client control', () => {
  const result = normalizeMetadata({ ...draft, entryId: 'client-controlled-id' }, new Date().toISOString());
  assert.equal(result.value.entryId, undefined);
  assert.equal(attachServerEntryId(result.value, '0191f000-0000-7000-8000-000000000000').entryId, '0191f000-0000-7000-8000-000000000000');
});
