import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateR2Archive } from '../src/archive.js';

function storedManifestBytes(manifest) {
  const entries = [
    ['manifest.json', new TextEncoder().encode(JSON.stringify(manifest))],
    ['portable-workspace.json', new TextEncoder().encode('{}')],
    ['payload/LOD0/mesh.buf', new Uint8Array([1, 2, 3, 4])],
  ];
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, nameBytes.length, true);
    locals.push(new Uint8Array([...header, ...nameBytes, ...data]));
    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centrals.push(new Uint8Array([...central, ...nameBytes]));
    offset += header.length + nameBytes.length + data.length;
  }
  const directory = new Uint8Array(centrals.reduce((sum, value) => sum + value.length, 0));
  let cursor = 0;
  for (const central of centrals) { directory.set(central, cursor); cursor += central.length; }
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, directory.length, true);
  eocdView.setUint32(16, offset, true);
  const archive = new Uint8Array(offset + directory.length + eocd.length);
  cursor = 0;
  for (const local of locals) { archive.set(local, cursor); cursor += local.length; }
  archive.set(directory, cursor);
  archive.set(eocd, cursor + directory.length);
  return archive;
}

test('R2 validation inspects the stored first manifest without loading the archive', async () => {
  const manifest = { archiveVersion: 1, portableMetadataPath: 'portable-workspace.json', fileCount: 1, totalUncompressedSize: 4, files: [{ path: 'payload/LOD0/mesh.buf', role: 'payload', size: 4, sha256: 'a'.repeat(64) }] };
  const bytes = storedManifestBytes(manifest);
  const digest = createHash('sha256').update(bytes).digest('hex');
  let getCount = 0;
  const env = { WORKSPACE_BUCKET: { async head() { return { size: bytes.length }; }, async get() { getCount += 1; return { async arrayBuffer() { return bytes.buffer; }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }; } } };
  const metadata = { fullData: { uncompressedSize: 4, fileCount: 1, sha256: digest } };
  assert.deepEqual(await validateR2Archive(env, 'packages/test.ssmtws', metadata), manifest);
  assert.equal(getCount, 3);
  await assert.rejects(() => validateR2Archive(env, 'packages/test.ssmtws', { fullData: { uncompressedSize: 5, fileCount: 1 } }), /ARCHIVE_MANIFEST_MISMATCH/);
});

test('R2 validation rejects a central-directory payload size that disagrees with the manifest', async () => {
  const manifest = { archiveVersion: 1, portableMetadataPath: 'portable-workspace.json', fileCount: 1, totalUncompressedSize: 4, files: [{ path: 'payload/LOD0/mesh.buf', role: 'payload', size: 4, sha256: 'a'.repeat(64) }] };
  const bytes = storedManifestBytes(manifest);
  let matches = 0;
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (new DataView(bytes.buffer).getUint32(index, true) === 0x02014b50 && ++matches === 3) new DataView(bytes.buffer).setUint32(index + 24, 5, true);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  const env = { WORKSPACE_BUCKET: { async head() { return { size: bytes.length }; }, async get() { return { async arrayBuffer() { return bytes.buffer; }, body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) }; } } };
  await assert.rejects(() => validateR2Archive(env, 'packages/test.ssmtws', { fullData: { uncompressedSize: 4, fileCount: 1, sha256: digest } }), /ARCHIVE_CENTRAL_DIRECTORY_MISMATCH/);
});
