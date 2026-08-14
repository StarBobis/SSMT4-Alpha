import test from 'node:test';
import assert from 'node:assert/strict';
import { isExpiredStatus } from '../src/github.js';

test('only removes entries explicitly expired past their delete-after date', () => {
  assert.equal(isExpiredStatus({ availability: 'expired', deleteAfter: '2026-01-01T00:00:00Z' }, '2026-01-01T00:00:00Z'), true);
  assert.equal(isExpiredStatus({ availability: 'expired', deleteAfter: '2027-01-01T00:00:00Z' }, '2026-01-01T00:00:00Z'), false);
  assert.equal(isExpiredStatus({ availability: 'active', deleteAfter: '2020-01-01T00:00:00Z' }, '2026-01-01T00:00:00Z'), false);
  assert.equal(isExpiredStatus({ availability: 'expired', deleteAfter: 'not-a-date' }, '2026-01-01T00:00:00Z'), false);
});
