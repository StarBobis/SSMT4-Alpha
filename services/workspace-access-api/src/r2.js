const SERVICE = 's3';

export async function createMultipart(env, objectKey) {
  const response = await signedRequest(env, 'POST', objectKey, { uploads: '' });
  const xml = await response.text();
  const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error('R2_MULTIPART_INIT_FAILED');
  return uploadId;
}

export async function presignPart(env, objectKey, uploadId, partNumber, expires = 3600) {
  const query = { partNumber: String(partNumber), uploadId, 'X-Amz-Expires': String(expires) };
  return signedUrl(env, 'PUT', objectKey, query, expires);
}

export async function presignObject(env, objectKey, expires = 900) {
  return signedUrl(env, 'GET', objectKey, {}, expires);
}

export async function completeMultipart(env, objectKey, uploadId, parts) {
  const body = `<CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
  return signedRequest(env, 'POST', objectKey, { uploadId }, body, 'application/xml');
}

export async function abortMultipart(env, objectKey, uploadId) {
  return signedRequest(env, 'DELETE', objectKey, { uploadId });
}

export async function headObject(env, objectKey) {
  const response = await signedRequest(env, 'HEAD', objectKey, {});
  return { size: Number(response.headers.get('content-length') || 0), etag: response.headers.get('etag') || '' };
}

export async function deleteObject(env, objectKey) {
  if (env.WORKSPACE_BUCKET && typeof env.WORKSPACE_BUCKET.delete === 'function') {
    await env.WORKSPACE_BUCKET.delete(objectKey);
    return;
  }
  await signedRequest(env, 'DELETE', objectKey, {});
}

async function signedRequest(env, method, objectKey, query, body, contentType) {
  const url = await signedUrl(env, method, objectKey, query, 0, body, contentType);
  const headers = contentType ? { 'content-type': contentType } : {};
  const response = await fetch(url, { method, headers, body });
  if (!response.ok) throw new Error('R2_REQUEST_FAILED');
  return response;
}

async function signedUrl(env, method, objectKey, query, expires, body = undefined, contentType = undefined) {
  const endpoint = String(env.R2_ENDPOINT || '').replace(/\/$/u, '');
  const bucket = String(env.R2_BUCKET_NAME || '');
  if (!endpoint || !bucket || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error('R2_NOT_CONFIGURED');
  const url = new URL(`${endpoint}/${encodePath(bucket)}/${encodePath(objectKey)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
  const date = amzDate.slice(0, 8);
  const host = url.host;
  const params = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${date}/auto/${SERVICE}/aws4_request`, 'X-Amz-Date': amzDate, 'X-Amz-Expires': String(expires > 0 ? expires : 900), 'X-Amz-SignedHeaders': 'host' };
  const canonicalQuery = canonicalParams(params);
  const canonicalUri = url.pathname;
  const canonicalHeaders = `host:${host}\n`;
  const payloadHash = expires > 0 ? 'UNSIGNED-PAYLOAD' : 'UNSIGNED-PAYLOAD';
  const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\nhost\n${payloadHash}`;
  const scope = `${date}/auto/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hex(await sha256(canonicalRequest))}`;
  const signature = hex(await hmac(await hmacSigningKey(env.R2_SECRET_ACCESS_KEY, date), stringToSign));
  return `${url.origin}${url.pathname}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function encodePath(value) { return String(value).split('/').map((segment) => awsEncode(segment)).join('/'); }
function canonicalParams(params) {
  return Object.keys(params)
    .map((key) => [awsEncode(key), awsEncode(params[key])])
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
      return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
function awsEncode(value) { return encodeURIComponent(String(value)).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function escapeXml(value) { return String(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;'); }
async function sha256(value) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); }
async function hmac(key, value) { return crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key instanceof ArrayBuffer ? key : new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(value)); }
async function hmacSigningKey(secret, date) { const kDate = await hmac(`AWS4${secret}`, date); const kRegion = await hmac(kDate, 'auto'); const kService = await hmac(kRegion, SERVICE); return hmac(kService, 'aws4_request'); }
function hex(buffer) { return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

export { awsEncode, canonicalParams };
