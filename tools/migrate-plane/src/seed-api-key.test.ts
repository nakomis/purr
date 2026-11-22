import { describe, expect, it } from 'vitest';
import { hashApiKey, newApiKey } from './seed-api-key.js';

describe('seed-api-key', () => {
  it('issues 43-character URL-safe keys that the API format check accepts', () => {
    const key = newApiKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newApiKey()).not.toBe(key);
  });

  it('hashes exactly as the API does (SHA-256, hex)', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
