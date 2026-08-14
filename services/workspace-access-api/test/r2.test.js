import test from 'node:test';
import assert from 'node:assert/strict';
import { awsEncode, canonicalParams } from '../src/r2.js';

test('R2 SigV4 encoding uses RFC3986 escaping and sorted encoded parameters', () => {
  assert.equal(awsEncode("a b!'()"), 'a%20b%21%27%28%29');
  assert.equal(canonicalParams({ z: 'two', a: 'a b', 'a!': 'value' }), 'a=a%20b&a%21=value&z=two');
  assert.equal(canonicalParams({ uploads: '', 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', partNumber: '1' }), 'X-Amz-Algorithm=AWS4-HMAC-SHA256&partNumber=1&uploads=');
});
