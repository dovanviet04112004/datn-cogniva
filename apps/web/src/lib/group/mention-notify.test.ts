/**
 * Unit test cho mention parser.
 *
 * Cover:
 *   - parseMentions extract @[name](id) syntax
 *   - dedupe id trùng
 *   - @everyone detect
 *   - content rỗng / không có mention
 */
import { describe, expect, it } from 'vitest';

import { parseMentions } from './mention-notify';

describe('parseMentions()', () => {
  it('extract 1 mention từ @[name](id)', () => {
    const out = parseMentions('Chào @[Nam](user123) sao rồi?');
    expect(out).toEqual([{ type: 'user', id: 'user123' }]);
  });

  it('extract nhiều mention', () => {
    const out = parseMentions('@[Nam](u1) và @[Mai](u2) ơi');
    expect(out).toEqual([
      { type: 'user', id: 'u1' },
      { type: 'user', id: 'u2' },
    ]);
  });

  it('dedupe id trùng (cùng user mention 2 lần)', () => {
    const out = parseMentions('@[Nam](u1) chào @[Nam](u1) again');
    expect(out).toEqual([{ type: 'user', id: 'u1' }]);
  });

  it('detect @everyone', () => {
    const out = parseMentions('@everyone họp ngay');
    expect(out).toContainEqual({ type: 'everyone', id: 'everyone' });
  });

  it('không match @everyone giữa từ (vd email)', () => {
    const out = parseMentions('liên hệ a@everyone.com');
    expect(out).not.toContainEqual({ type: 'everyone', id: 'everyone' });
  });

  it('content rỗng → []', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions('hello không có mention')).toEqual([]);
  });

  it('id chứa hyphen + alphanumeric vẫn match', () => {
    const out = parseMentions('@[ABC](abc-123_xyz)');
    expect(out).toEqual([{ type: 'user', id: 'abc-123_xyz' }]);
  });
});
