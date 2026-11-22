import { describe, expect, it } from 'vitest';
import { agentActor, hashApiKey, newApiKey } from './seed-api-key.js';

describe('seed-api-key', () => {
  it('issues 43-character URL-safe keys that the API format check accepts', () => {
    const key = newApiKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newApiKey()).not.toBe(key);
  });

  it('hashes exactly as the API does (SHA-256, hex)', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('issues keys to agents, including the Purr3D game', () => {
    expect(agentActor('claude')).toBe('claude');
    expect(agentActor('bau')).toBe('bau');
    expect(agentActor('purr3d')).toBe('purr3d');
  });

  it('refuses keys for martin, system, unknown actors and a missing --actor', () => {
    for (const bad of ['martin', 'system', 'mallory', '', undefined]) {
      expect(() => agentActor(bad)).toThrow(/--actor must be an agent: claude, bau or purr3d/);
    }
  });
});
