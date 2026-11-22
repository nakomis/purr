import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors.js';
import { normaliseEpicRef, normaliseTaskRef, parseTaskRef, validatePrefix } from './refs.js';

describe('refs', () => {
  it('parses and normalises task refs', () => {
    expect(parseTaskRef('home-42')).toEqual({ prefix: 'HOME', sequence: 42 });
    expect(normaliseTaskRef('chats-1')).toBe('CHATS-1');
    expect(() => normaliseTaskRef('HOME-0')).toThrow(ValidationError);
    expect(() => normaliseTaskRef('EPIC-3')).toThrow(ValidationError);
    expect(() => normaliseTaskRef('nonsense')).toThrow(ValidationError);
  });

  it('normalises epic refs', () => {
    expect(normaliseEpicRef('epic-7')).toBe('EPIC-7');
    expect(() => normaliseEpicRef('HOME-7')).toThrow(ValidationError);
  });

  it('validates prefixes', () => {
    expect(validatePrefix('PURR')).toBe('PURR');
    expect(() => validatePrefix('purr')).toThrow(ValidationError);
    expect(() => validatePrefix('EPIC')).toThrow(ValidationError);
    expect(() => validatePrefix('A')).toThrow(ValidationError);
  });
});
