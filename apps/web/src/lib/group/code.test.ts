import { describe, expect, it } from 'vitest';

import { generateInviteCode, normalizeInviteCode } from './code';

describe('generateInviteCode()', () => {
  it('trả 8 ký tự', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it('chỉ chứa ký tự Crockford base32 (loại I/L/O/U)', () => {
    const allowed = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(allowed);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('100 code liên tiếp không có duplicate (random thật)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateInviteCode());
    }
    expect(codes.size).toBe(100);
  });
});

describe('normalizeInviteCode()', () => {
  it('uppercase', () => {
    expect(normalizeInviteCode('abcd1234')).toBe('ABCD1234');
  });

  it('strip space', () => {
    expect(normalizeInviteCode('abcd 1234')).toBe('ABCD1234');
    expect(normalizeInviteCode('  abcd  1234  ')).toBe('ABCD1234');
  });

  it('strip dash', () => {
    expect(normalizeInviteCode('abcd-1234')).toBe('ABCD1234');
  });

  it('combo space + dash + case', () => {
    expect(normalizeInviteCode('abc-1 2- 34')).toBe('ABC1234');
  });
});
