const GITHUB_API = 'https://api.github.com';

export async function publishEntry(env, metadata, status, entryId) {
  const token = await githubToken(env);
  const metadataPath = `games/${metadata.gamePreset}/entries/${entryId}/metadata.json`;
  const statusPath = `games/${metadata.gamePreset}/entries/${entryId}/status.json`;
  const metadataBlob = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/blobs`, {
    method: 'POST', body: JSON.stringify({ content: JSON.stringify(metadata, null, 2), encoding: 'utf-8' }),
  });
  const statusBlob = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/blobs`, {
    method: 'POST', body: JSON.stringify({ content: JSON.stringify(status, null, 2), encoding: 'utf-8' }),
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const ref = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/ref/heads/main`);
      const commit = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/commits/${ref.object.sha}`);
      const tree = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/trees`, {
        method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: [
          { path: metadataPath, mode: '100644', type: 'blob', sha: metadataBlob.sha },
          { path: statusPath, mode: '100644', type: 'blob', sha: statusBlob.sha },
        ] }),
      });
      const nextCommit = await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/commits`, {
        method: 'POST', body: JSON.stringify({ message: `Publish workspace entry ${entryId}`, tree: tree.sha, parents: [ref.object.sha] }),
      });
      await githubJson(env, token, `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}/git/refs/heads/main`, {
        method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }),
      });
      return { metadataPath, statusPath };
    } catch (error) {
      if (![409, 422].includes(error?.status) || attempt === 2) throw error;
    }
  }
  throw new Error('GITHUB_PUBLISH_FAILED');
}

export async function fetchPublicEntry(env, gamePreset, entryId) {
  if (!/^[0-9a-f-]{36}$/iu.test(entryId)) return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(String(gamePreset || ''))) return null;
  const base = `https://raw.githubusercontent.com/${encodeURIComponent(env.PUBLIC_REPO_OWNER)}/${encodeURIComponent(env.PUBLIC_REPO_NAME)}/main/games/${encodeURIComponent(gamePreset)}/entries/${encodeURIComponent(entryId)}`;
  const metadataResponse = await fetch(`${base}/metadata.json`, { headers: { 'user-agent': 'ssmt-workspace-api' } });
  if (metadataResponse.status === 404) return null;
  if (!metadataResponse.ok) throw new Error('GITHUB_READ_FAILED');
  const statusResponse = await fetch(`${base}/status.json`, { headers: { 'user-agent': 'ssmt-workspace-api' } });
  if (statusResponse.status === 404) return null;
  if (!statusResponse.ok) throw new Error('GITHUB_READ_FAILED');
  return { metadata: await metadataResponse.json(), status: await statusResponse.json() };
}

export async function publishDownloadCounts(env, gamePreset, entryId, counts) {
  const token = await githubToken(env);
  const repository = `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}`;
  const statusPath = `games/${gamePreset}/entries/${entryId}/status.json`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current = await githubJson(env, token, `${repository}/contents/${statusPath}?ref=main`);
      const status = decodeGithubContent(current);
      const nextStatus = {
        ...status,
        metadataDownloadCount: Math.max(Number(status.metadataDownloadCount) || 0, Number(counts.metadataDownloadCount) || 0),
        fullPackageDownloadCount: Math.max(Number(status.fullPackageDownloadCount) || 0, Number(counts.fullPackageDownloadCount) || 0),
      };
      const statusBlob = await githubJson(env, token, `${repository}/git/blobs`, {
        method: 'POST', body: JSON.stringify({ content: JSON.stringify(nextStatus, null, 2), encoding: 'utf-8' }),
      });
      const ref = await githubJson(env, token, `${repository}/git/ref/heads/main`);
      const commit = await githubJson(env, token, `${repository}/git/commits/${ref.object.sha}`);
      const tree = await githubJson(env, token, `${repository}/git/trees`, {
        method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: [
          { path: statusPath, mode: '100644', type: 'blob', sha: statusBlob.sha },
        ] }),
      });
      const nextCommit = await githubJson(env, token, `${repository}/git/commits`, {
        method: 'POST', body: JSON.stringify({ message: `Record workspace downloads for ${entryId}`, tree: tree.sha, parents: [ref.object.sha] }),
      });
      await githubJson(env, token, `${repository}/git/refs/heads/main`, {
        method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }),
      });
      return;
    } catch (error) {
      if (![409, 422].includes(error?.status) || attempt === 2) throw error;
    }
  }
}

export async function removeExpiredEntries(env, now = new Date().toISOString()) {
  const token = await githubToken(env);
  const repository = `/repos/${env.PUBLIC_REPO_OWNER}/${env.PUBLIC_REPO_NAME}`;
  const ref = await githubJson(env, token, `${repository}/git/ref/heads/main`);
  const commit = await githubJson(env, token, `${repository}/git/commits/${ref.object.sha}`);
  const tree = await githubJson(env, token, `${repository}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('GITHUB_TREE_TRUNCATED');
  const blobs = new Map(tree.tree.filter((item) => item.type === 'blob').map((item) => [item.path, item.sha]));
  const metadataByEntry = new Map();
  const statusByEntry = new Map();
  for (const [path, sha] of blobs) {
    const match = path.match(/^games\/([^/]+)\/entries\/([0-9a-f-]+)\/(metadata|status)\.json$/u);
    if (!match) continue;
    const target = match[3] === 'metadata' ? metadataByEntry : statusByEntry;
    target.set(`${match[1]}/${match[2]}`, { path, sha });
  }
  const metadata = new Map();
  for (const [entry, value] of metadataByEntry) metadata.set(entry, await readBlobJson(env, token, repository, value.sha));
  const expired = [];
  for (const [entry, value] of statusByEntry) {
    const status = await readBlobJson(env, token, repository, value.sha);
    if (!isExpiredStatus(status, now) || !metadata.has(entry)) continue;
    expired.push({ entry, metadata: metadata.get(entry), metadataPath: metadataByEntry.get(entry).path, statusPath: value.path });
  }
  if (!expired.length) return [];
  const removed = new Set(expired.map((item) => item.entry));
  const survivingObjectKeys = new Set([...metadata.entries()]
    .filter(([entry]) => !removed.has(entry))
    .map(([, value]) => value?.fullData?.objectKey)
    .filter((value) => typeof value === 'string'));
  const changes = expired.flatMap((item) => [
    { path: item.metadataPath, mode: '100644', type: 'blob', sha: null },
    { path: item.statusPath, mode: '100644', type: 'blob', sha: null },
  ]);
  const nextTree = await githubJson(env, token, `${repository}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: changes }) });
  const nextCommit = await githubJson(env, token, `${repository}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `Remove ${expired.length} expired workspace entries`, tree: nextTree.sha, parents: [ref.object.sha] }) });
  await githubJson(env, token, `${repository}/git/refs/heads/main`, { method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }) });
  return expired.map((item) => ({ entryId: item.metadata.entryId, objectKey: item.metadata?.fullData?.objectKey || null, deleteObject: !survivingObjectKeys.has(item.metadata?.fullData?.objectKey) }));
}

export function isExpiredStatus(status, now = new Date().toISOString()) {
  const deleteAfter = Date.parse(status?.deleteAfter || '');
  return status?.availability === 'expired' && Number.isFinite(deleteAfter) && deleteAfter <= Date.parse(now);
}

async function installationToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iat: now - 30, exp: now + 540, iss: String(env.GITHUB_APP_ID) }));
  const key = await importPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(`${header}.${payload}`));
  const jwt = `${header}.${payload}.${base64Url(signature)}`;
  const response = await fetch(`${GITHUB_API}/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, accept: 'application/vnd.github+json', 'user-agent': 'ssmt-workspace-api' },
  });
  if (!response.ok) throw httpError(response.status);
  const body = await response.json();
  if (typeof body.token !== 'string') throw new Error('GITHUB_PUBLISH_FAILED');
  return body.token;
}

async function githubToken(env) {
  const token = String(env.GITHUB_TOKEN || '').trim();
  return token || installationToken(env);
}

async function githubJson(env, token, path, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'ssmt-workspace-api', ...(init.headers || {}) },
  });
  if (!response.ok) throw httpError(response.status);
  return response.json();
}

async function readBlobJson(env, token, repository, sha) {
  const blob = await githubJson(env, token, `${repository}/git/blobs/${sha}`);
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('GITHUB_BLOB_INVALID');
  const binary = atob(blob.content.replace(/\s+/gu, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function decodeGithubContent(content) {
  if (content?.encoding !== 'base64' || typeof content.content !== 'string') throw new Error('GITHUB_BLOB_INVALID');
  const binary = atob(content.content.replace(/\s+/gu, ''));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function httpError(status) {
  const error = new Error('GITHUB_PUBLISH_FAILED');
  error.status = status;
  return error;
}

async function importPrivateKey(value) {
  const pem = String(value || '').replace(/\\n/g, '\n');
  const isPkcs1 = pem.includes('BEGIN RSA PRIVATE KEY');
  const body = pem.replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s+/g, '');
  if (!body) throw new Error('GITHUB_PUBLISH_FAILED');
  let binary = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  if (isPkcs1) binary = wrapPkcs1AsPkcs8(binary);
  return crypto.subtle.importKey('pkcs8', binary.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function wrapPkcs1AsPkcs8(pkcs1) {
  const algorithm = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  const version = Uint8Array.from([0x02, 0x01, 0x00]);
  const octet = Uint8Array.from([0x04, ...derLength(pkcs1.length), ...pkcs1]);
  const content = Uint8Array.from([...version, ...algorithm, ...octet]);
  return Uint8Array.from([0x30, ...derLength(content.length), ...content]);
}

function derLength(length) {
  if (length < 128) return [length];
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function base64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
