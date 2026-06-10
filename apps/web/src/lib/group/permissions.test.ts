/**
 * Unit test cho permission matrix study group.
 *
 * Cover:
 *   - Role hierarchy (rank ordering)
 *   - Action allowed/denied đúng theo role
 *   - Edge cases: null role, action không định nghĩa, isMuted
 */
import { describe, expect, it } from 'vitest';

import { can, denyReason, isHigherRole, isMuted, ROLE_RANK } from './permissions';

describe('ROLE_RANK', () => {
  it('OWNER > ADMIN > MODERATOR > MEMBER', () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.ADMIN);
    expect(ROLE_RANK.ADMIN).toBeGreaterThan(ROLE_RANK.MODERATOR);
    expect(ROLE_RANK.MODERATOR).toBeGreaterThan(ROLE_RANK.MEMBER);
  });
});

describe('can()', () => {
  it('OWNER pass mọi action', () => {
    expect(can('OWNER', 'group.delete')).toBe(true);
    expect(can('OWNER', 'channel.create')).toBe(true);
    expect(can('OWNER', 'member.kick')).toBe(true);
    expect(can('OWNER', 'message.send')).toBe(true);
  });

  it('ADMIN không xoá được group nhưng quản trị channel/member', () => {
    expect(can('ADMIN', 'group.delete')).toBe(false);
    expect(can('ADMIN', 'channel.create')).toBe(true);
    expect(can('ADMIN', 'channel.delete')).toBe(true);
    expect(can('ADMIN', 'member.kick')).toBe(true);
    expect(can('ADMIN', 'group.update-meta')).toBe(true);
  });

  it('MODERATOR chỉ mute/delete msg, không CRUD channel', () => {
    expect(can('MODERATOR', 'message.delete-any')).toBe(true);
    expect(can('MODERATOR', 'member.mute')).toBe(true);
    expect(can('MODERATOR', 'channel.create')).toBe(false);
    expect(can('MODERATOR', 'channel.delete')).toBe(false);
    expect(can('MODERATOR', 'member.kick')).toBe(false);
    expect(can('MODERATOR', 'member.ban')).toBe(false);
  });

  it('MEMBER chỉ chat/voice/react', () => {
    expect(can('MEMBER', 'message.send')).toBe(true);
    expect(can('MEMBER', 'message.react')).toBe(true);
    expect(can('MEMBER', 'voice.connect')).toBe(true);
    expect(can('MEMBER', 'invite.create')).toBe(true); // member tự tạo invite riêng
    expect(can('MEMBER', 'message.delete-any')).toBe(false);
    expect(can('MEMBER', 'channel.create')).toBe(false);
    expect(can('MEMBER', 'member.mute')).toBe(false);
  });

  it('null/undefined role → deny tất cả', () => {
    expect(can(null, 'message.send')).toBe(false);
    expect(can(undefined, 'voice.connect')).toBe(false);
  });
});

describe('isHigherRole()', () => {
  it('OWNER > MEMBER', () => {
    expect(isHigherRole('OWNER', 'MEMBER')).toBe(true);
    expect(isHigherRole('MEMBER', 'OWNER')).toBe(false);
  });

  it('same role không cao hơn', () => {
    expect(isHigherRole('ADMIN', 'ADMIN')).toBe(false);
  });

  it('ADMIN > MODERATOR > MEMBER', () => {
    expect(isHigherRole('ADMIN', 'MODERATOR')).toBe(true);
    expect(isHigherRole('MODERATOR', 'MEMBER')).toBe(true);
    expect(isHigherRole('ADMIN', 'MEMBER')).toBe(true);
  });
});

describe('isMuted()', () => {
  it('mutedUntil null = không mute', () => {
    expect(isMuted({ mutedUntil: null })).toBe(false);
  });

  it('mutedUntil tương lai = đang mute', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isMuted({ mutedUntil: future })).toBe(true);
  });

  it('mutedUntil quá khứ = hết mute', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isMuted({ mutedUntil: past })).toBe(false);
  });
});

describe('denyReason()', () => {
  it('trả empty khi role có quyền', () => {
    expect(denyReason('OWNER', 'group.delete')).toBe('');
  });

  it('trả message tiếng Việt khi role thiếu quyền', () => {
    expect(denyReason('MEMBER', 'channel.create')).toMatch(/không có quyền/i);
  });

  it('trả "không phải thành viên" khi role null', () => {
    expect(denyReason(null, 'message.send')).toMatch(/thành viên/i);
  });
});
