# Plan — Study Group (Discord-style) — Phase 20

> **Status:** V1 đã implement (Batch A–E + settings tabs). Migration `0011_study_group_channels.sql` applied, schema + APIs + UI 3-column hoạt động. Còn V2 polish (audit log mod, push mention, slash command, threads).
>
> **Mục tiêu:** Biến `studyGroup` hiện tại (Phase 9 v1 — chỉ list members + invite code) thành **Discord-style server** với multi-channel chat + voice rooms theo môn học. Mỗi group có nhiều channel TEXT (chat tổng + chat môn) và VOICE (live theo môn).
>
> **Trạng thái hiện tại:** Cogniva đã có `studyGroup`, `studyGroupMember`, `room` (LiveKit), `roomMessage`. Phase 20 thêm `study_group_channel`, `study_group_message`, `study_group_invite` + UI 3-column.
>
> **Stack tận dụng:** Socket.IO self-host (gateway `apps/realtime` — chat realtime + presence) + LiveKit Cloud (voice rooms) + PostgreSQL + Next.js App Router + Better Auth.

---

## 0. Big Picture — Discord-style data model

```
Cogniva Study Group  ←≡ Discord Server
├─ Members (with role per group)         ←≡ Server members + roles
├─ Channels                              ←≡ Channels
│  ├─ TEXT channel (chat tổng / theo môn) ←≡ Text channel
│  │  └─ Messages (with reactions, replies, attachments)
│  ├─ VOICE channel (live theo môn)       ←≡ Voice channel
│  │  └─ LiveKit room (audio/video + screen share + chat sidebar)
│  └─ ANNOUNCEMENT (chỉ admin post — V2)  ←≡ Announcement channel
├─ Invite codes (multi-use + expiry)      ←≡ Invite links
└─ Roles & permissions                    ←≡ Roles
```

**Use case mẫu (lớp KTPM-K15):**
- Group "KTPM-K15" — 30 members
  - `#chung` (TEXT) — chat tổng cho tất cả
  - `#thông-báo` (TEXT, mod-only post) — announcement từ lớp trưởng
  - `#toán-cao-cấp` (TEXT) — hỏi bài môn Toán
  - `#lập-trình` (TEXT) — hỏi bài môn LT
  - `🔊 Phòng học Toán` (VOICE) — học nhóm Toán, 8 ghế
  - `🔊 Phòng học LT` (VOICE) — học nhóm LT, 8 ghế
  - `🔊 Hangout` (VOICE) — chill room, không giới hạn
- Roles:
  - OWNER (lớp trưởng) — full quyền
  - MODERATOR (cán sự lớp) — kick, ban, delete msg
  - MEMBER (sinh viên) — chat, voice
  - MUTED (vi phạm) — read-only

---

## 1. Schema delta (migration 0011_study_group_channels.sql)

### 1.1. Extend `study_group`

```sql
ALTER TABLE study_group
  ADD COLUMN icon_url text,
  ADD COLUMN banner_url text,
  ADD COLUMN is_public boolean NOT NULL DEFAULT false,  -- public discovery (V2)
  ADD COLUMN max_members integer NOT NULL DEFAULT 100;
```

### 1.2. Bảng mới `study_group_channel`

```typescript
export const channelTypeEnum = pgEnum('channel_type', ['TEXT', 'VOICE', 'ANNOUNCEMENT']);

export const studyGroupChannel = pgTable(
  'study_group_channel',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),                 // 'chung', 'toán-cao-cấp'
    type: channelTypeEnum('type').notNull(),
    topic: text('topic'),                          // mô tả ngắn dưới header
    /** Order trong sidebar — nhỏ nhất trên cùng. Drag-drop reorder update. */
    position: integer('position').notNull().default(0),
    /** Private channel: chỉ user có override-permission mới thấy. V2. */
    isPrivate: boolean('is_private').notNull().default(false),
    /** Slow mode — giây delay giữa 2 message của cùng user. NULL = off. */
    slowModeSeconds: integer('slow_mode_seconds'),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** LiveKit room name cho VOICE channel — link 1-1 với LiveKit Cloud. */
    livekitRoomName: text('livekit_room_name'),
    /** Max participants cho VOICE channel — NULL = không giới hạn (chỉ LiveKit plan limit). */
    voiceMaxParticipants: integer('voice_max_participants'),
  },
  (t) => ({
    groupPosIdx: index('study_group_channel_group_pos_idx').on(t.groupId, t.position),
    livekitIdx: uniqueIndex('study_group_channel_livekit_idx').on(t.livekitRoomName),
  }),
);
```

### 1.3. Bảng mới `study_group_message`

```typescript
export const studyGroupMessage = pgTable(
  'study_group_message',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    /** 'text' | 'markdown' — V1 chỉ markdown render basic. */
    contentType: text('content_type').notNull().default('markdown'),
    /** Reply to một message khác — render thread chip. */
    replyToId: text('reply_to_id'),
    /** [{ type: 'image'|'file', url, name, size, mime }] — V2 upload R2. */
    attachments: jsonb('attachments').$type<Array<{
      type: 'image' | 'file' | 'audio';
      url: string;
      name: string;
      size: number;
      mime: string;
    }>>(),
    /** { '👍': ['userId1','userId2'], '❤️': ['userId3'] } — aggregate count + who reacted. */
    reactions: jsonb('reactions').$type<Record<string, string[]>>(),
    /** Pin lên top channel — V2. */
    pinned: boolean('pinned').notNull().default(false),
    /** Mentions cho notification — [{ type: 'user'|'channel'|'everyone', id }]. */
    mentions: jsonb('mentions').$type<Array<{ type: string; id: string }>>(),
    editedAt: timestamp('edited_at'),
    deletedAt: timestamp('deleted_at'),  // soft delete để giữ thread context
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    channelTimeIdx: index('study_group_message_channel_time_idx').on(
      t.channelId,
      t.createdAt,
    ),
    authorIdx: index('study_group_message_author_idx').on(t.authorId),
  }),
);
```

### 1.4. Extend `study_group_member`

```sql
ALTER TABLE study_group_member
  ADD COLUMN nickname text,                      -- per-group display name
  ADD COLUMN muted_until timestamp,              -- timeout (anti-spam)
  ADD COLUMN last_seen_at timestamp;             -- last online ping
```

Mở rộng `groupRoleEnum`:
```sql
-- Cũ: OWNER, MEMBER
-- Mới: OWNER, ADMIN, MODERATOR, MEMBER
ALTER TYPE group_role ADD VALUE 'ADMIN';
ALTER TYPE group_role ADD VALUE 'MODERATOR';
```

### 1.5. Bảng mới `study_group_read_state`

> Unread badge cho mỗi channel — track lastReadMessageId per (userId, channelId).

```typescript
export const studyGroupReadState = pgTable(
  'study_group_read_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    lastReadMessageId: text('last_read_message_id'),
    /** Optional mute — không hiện badge cho channel này. */
    muted: boolean('muted').notNull().default(false),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.channelId] }),
  }),
);
```

### 1.6. Bảng mới `study_group_invite`

> Thay thế `studyGroup.inviteCode` (single code) bằng multi-invite với expiry + use limit.

```typescript
export const studyGroupInvite = pgTable(
  'study_group_invite',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    groupId: text('group_id')
      .notNull()
      .references(() => studyGroup.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),        // 8-char base32, share-friendly
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    maxUses: integer('max_uses'),                  // NULL = unlimited
    usesCount: integer('uses_count').notNull().default(0),
    expiresAt: timestamp('expires_at'),            // NULL = never
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
);
```

### 1.7. Bảng mới `study_group_voice_state` (in-memory mirror)

> Realtime presence trong voice channel — ai đang trong room nào.
> **Source of truth:** LiveKit Cloud webhook. DB cache để query nhanh khi load group page.

```typescript
export const studyGroupVoiceState = pgTable(
  'study_group_voice_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    channelId: text('channel_id')
      .notNull()
      .references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
    /** Self-muted (mic off) — sync từ LiveKit metadata. */
    selfMuted: boolean('self_muted').notNull().default(false),
    /** Server-muted bởi moderator. */
    serverMuted: boolean('server_muted').notNull().default(false),
    /** Streaming camera/screen — visual indicator. */
    camera: boolean('camera').notNull().default(false),
    screenShare: boolean('screen_share').notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId] }),  // 1 user chỉ trong 1 voice channel
    channelIdx: index('study_group_voice_state_channel_idx').on(t.channelId),
  }),
);
```

---

## 2. API design

### 2.1. Group CRUD

| Endpoint | Mô tả |
|---|---|
| `GET /api/groups` | List group user đã join (owned + member) |
| `POST /api/groups` | Tạo group mới — auto create `#chung` TEXT channel + invite code |
| `GET /api/groups/[id]` | Detail group + channels list + members list |
| `PUT /api/groups/[id]` | Update name/description/iconUrl (owner/admin) |
| `DELETE /api/groups/[id]` | Xoá group (owner only) — cascade kênh + message |

### 2.2. Member management

| Endpoint | Mô tả |
|---|---|
| `POST /api/groups/join` | Body `{ code }` → resolve invite → add member |
| `GET /api/groups/[id]/members` | List members + role + online status |
| `PUT /api/groups/[id]/members/[userId]` | Update role / nickname (admin) |
| `DELETE /api/groups/[id]/members/[userId]` | Kick (admin) hoặc leave (self) |
| `POST /api/groups/[id]/members/[userId]/mute` | Body `{ duration: 3600 }` → temporary mute |
| `POST /api/groups/[id]/members/[userId]/ban` | Permanent ban — block re-invite |

### 2.3. Invite codes

| Endpoint | Mô tả |
|---|---|
| `GET /api/groups/[id]/invites` | List active invites (mod) |
| `POST /api/groups/[id]/invites` | Body `{ maxUses?, expiresInSec? }` → tạo invite mới |
| `DELETE /api/groups/[id]/invites/[code]` | Revoke invite |

### 2.4. Channels

| Endpoint | Mô tả |
|---|---|
| `GET /api/groups/[id]/channels` | List channels của group (sorted by position) |
| `POST /api/groups/[id]/channels` | Body `{ name, type, topic? }` → tạo channel. Mod+ only |
| `PUT /api/groups/[id]/channels/[channelId]` | Update name/topic/position |
| `DELETE /api/groups/[id]/channels/[channelId]` | Xoá channel (cascade messages) |
| `POST /api/groups/[id]/channels/reorder` | Body `{ orders: [{id, position}] }` — drag-drop |

### 2.5. Messages (TEXT channel)

| Endpoint | Mô tả |
|---|---|
| `GET /api/channels/[id]/messages?before=X&limit=50` | Pagination cursor-based |
| `POST /api/channels/[id]/messages` | Body `{ content, replyToId?, attachments?, mentions? }` |
| `PUT /api/channels/[id]/messages/[msgId]` | Edit own message |
| `DELETE /api/channels/[id]/messages/[msgId]` | Soft delete (mod có thể delete bất kỳ) |
| `POST /api/channels/[id]/messages/[msgId]/react` | Body `{ emoji }` toggle reaction |
| `POST /api/channels/[id]/read` | Body `{ lastMessageId }` → update read state |

### 2.6. Voice (VOICE channel)

| Endpoint | Mô tả |
|---|---|
| `POST /api/channels/[id]/voice/token` | Trả LiveKit JWT cho user join channel |
| `POST /api/channels/[id]/voice/leave` | Manually leave + clear voice state |
| `GET /api/channels/[id]/voice/participants` | List user đang trong voice channel |
| `POST /api/webhooks/livekit-group` | LiveKit webhook → update `study_group_voice_state` |

### 2.7. Realtime auth extension

Extend `/api/realtime/auth` để authorize 3 channel mới:

- `presence-group-{groupId}` — group presence (ai online). Yêu cầu member status ACTIVE.
- `private-channel-{channelId}` — text channel messages. Yêu cầu member group đó.
- `presence-voice-{channelId}` — voice channel state. Yêu cầu member + channel.type=VOICE.

---

## 3. Realtime architecture

### 3.1. Events qua Socket.IO (gateway `apps/realtime`)

| Channel | Event | Payload | Khi nào fire |
|---|---|---|---|
| `private-channel-{channelId}` | `message:new` | `{ id, content, authorId, createdAt, ... }` | POST /messages |
| `private-channel-{channelId}` | `message:edit` | `{ id, content, editedAt }` | PUT /messages/[id] |
| `private-channel-{channelId}` | `message:delete` | `{ id }` | DELETE /messages/[id] |
| `private-channel-{channelId}` | `message:react` | `{ id, reactions }` | POST /react |
| `private-channel-{channelId}` | `typing` | `{ userId, userName }` | Client emit khi gõ |
| `presence-group-{groupId}` | `member:join` | `{ userId, userName }` | POST /join thành công |
| `presence-group-{groupId}` | `member:leave` | `{ userId }` | DELETE /members |
| `presence-group-{groupId}` | `member:role-change` | `{ userId, role }` | PUT role |
| `presence-group-{groupId}` | `channel:created` | `{ channel }` | POST /channels |
| `presence-group-{groupId}` | `channel:deleted` | `{ channelId }` | DELETE /channels |
| `presence-voice-{channelId}` | `voice:join` | `{ userId, userName }` | LiveKit webhook participant_joined |
| `presence-voice-{channelId}` | `voice:leave` | `{ userId }` | participant_left |
| `presence-voice-{channelId}` | `voice:mute` | `{ userId, selfMuted, serverMuted }` | trackPublished/Unpublished |

### 3.2. Voice flow

```
1. User click channel VOICE → POST /api/channels/[id]/voice/token
2. Server check membership + group permissions
3. Server gen LiveKit JWT (identity = userId, roomName = channel.livekitRoomName)
4. Client init LiveKit Room with token + connect
5. LiveKit Cloud fire webhook `participant_joined`
6. /api/webhooks/livekit-group:
   - INSERT vào study_group_voice_state
   - triggerEvent presence-voice-{channelId} → voice:join
7. Other clients listening → update participant list realtime
```

### 3.3. Typing indicator

- Client emit `typing` event qua Socket.IO (gateway broadcast lại cho cùng channel, không qua API)
- Debounce 3s — auto stop
- Channel `private-channel-{channelId}` — gateway `apps/realtime` relay event giữa các client đã authorize

---

## 4. UI design — Discord 3-column layout

### 4.1. Route structure

```
/groups                          → list groups user joined (overview)
/groups/[id]                     → redirect to default channel (#chung)
/groups/[id]/[channelId]         → 3-column: channel sidebar | message area | member sidebar
```

### 4.2. Layout

```
┌──────────┬─────────────────────────────────────────┬──────────────┐
│ GROUP    │  Header: #toán-cao-cấp · 30 members     │ MEMBER LIST  │
│ SIDEBAR  ├─────────────────────────────────────────┤              │
│          │                                          │ Online — 5   │
│ - Cogniva│  ┌──────────────────────────────────┐  │ ● Nam (đang nói)
│ - KTPM   │  │ Ngày 10/05 ────────────          │  │ ● Mai         │
│ - K15    │  │                                   │  │ ● Linh        │
│   (active│  │ Nam · 10:30                       │  │               │
│   ring)  │  │ Bài 3.4 chỗ nào khó vậy mọi ng?  │  │ Offline — 12  │
│          │  │   ↳ Mai: tớ cũng đang vướng       │  │ ○ Hùng        │
│ CHANNELS │  │                                   │  │ ○ Lan         │
│ ────     │  │ Linh · 10:35                      │  │               │
│ TEXT     │  │ Cho mình hỏi câu này:             │  │               │
│ # chung  │  │ ![image](upload.jpg)              │  │               │
│ # toán   │  │ 👍 3  ❤️ 1                        │  │               │
│ # lt     │  │                                   │  │               │
│          │  └──────────────────────────────────┘  │               │
│ VOICE    │                                          │               │
│ 🔊 Toán  │  ┌──────────────────────────────────┐  │               │
│   ● 2/8  │  │ Gõ tin nhắn... (markdown OK)     │  │               │
│ 🔊 LT    │  │ [+ attach]  [😀 emoji]  [@ ment] │  │               │
│   ○ 0/8  │  └──────────────────────────────────┘  │               │
└──────────┴─────────────────────────────────────────┴──────────────┘
```

### 4.3. Component list

```
src/app/(app)/groups/
├── page.tsx                              # /groups overview
├── new/page.tsx                          # /groups/new — tạo group
├── [id]/
│   ├── layout.tsx                        # 3-col shell
│   ├── page.tsx                          # redirect → default channel
│   ├── [channelId]/
│   │   └── page.tsx                      # channel view (text OR voice)
│   ├── settings/
│   │   ├── page.tsx                      # /groups/[id]/settings
│   │   ├── members/page.tsx              # member roles/kick
│   │   ├── channels/page.tsx             # channel CRUD + reorder
│   │   ├── invites/page.tsx              # invite link manager
│   │   └── permissions/page.tsx          # role permissions (V2)

src/components/groups/
├── group-sidebar.tsx                     # left col: groups list + channels
├── channel-list.tsx                      # text + voice channels (collapsible)
├── channel-item.tsx                      # single channel row + unread badge
├── voice-channel-participants.tsx        # avatars stacked in voice channel
├── message-list.tsx                      # virtualized message scroll
├── message-item.tsx                      # 1 message + reactions + reply
├── message-composer.tsx                  # input + emoji + attach + mention
├── member-sidebar.tsx                    # right col: members grouped by role
├── presence-indicator.tsx                # online/idle/dnd dot
├── voice-channel-view.tsx                # khi vào voice → LiveKit grid
├── voice-control-bar.tsx                 # mute/cam/screen/leave buttons
├── channel-create-dialog.tsx             # modal tạo channel
├── invite-dialog.tsx                     # modal share invite link
└── role-editor.tsx                       # admin assign role

src/components/groups/markdown/
├── render.tsx                            # render markdown — re-use chat/markdown
└── mentions.tsx                          # @user / #channel pills
```

### 4.4. UX details

- **Unread indicator:** channel name **bold** khi có message mới sau lastReadAt. Đỏ pill số message nếu mention.
- **Typing:** "Nam đang gõ..." dưới composer
- **Voice participants:** avatar stack ngay dưới channel name, max 4 visible + "+N"
- **Reactions:** click emoji icon → toggle add/remove. Hover hiện danh sách user đã react.
- **Reply:** swipe message → reply chip. Click chip jump to original.
- **Slash commands:** `/giphy`, `/poll`, `/code` — V2.
- **Search:** Ctrl+K mở quick switcher (channels + members + messages) — V2.

---

## 5. Permissions & roles

### 5.1. Role hierarchy

```
OWNER     — tạo group, full quyền, không xoá được trừ self leave
ADMIN     — quản trị channel + member, không xoá owner
MODERATOR — delete msg, mute member, không thay role
MEMBER    — chat, voice, react
MUTED     — read-only (auto-clear sau mutedUntil)
```

### 5.2. Permission matrix

| Action | OWNER | ADMIN | MOD | MEMBER |
|---|---|---|---|---|
| Send message | ✓ | ✓ | ✓ | ✓ |
| Edit own message | ✓ | ✓ | ✓ | ✓ |
| Delete any message | ✓ | ✓ | ✓ | ✗ |
| React to message | ✓ | ✓ | ✓ | ✓ |
| Connect voice | ✓ | ✓ | ✓ | ✓ |
| Mute voice (server) | ✓ | ✓ | ✓ | ✗ |
| Create channel | ✓ | ✓ | ✗ | ✗ |
| Delete channel | ✓ | ✓ | ✗ | ✗ |
| Mute member | ✓ | ✓ | ✓ | ✗ |
| Kick member | ✓ | ✓ | ✗ | ✗ |
| Ban member | ✓ | ✓ | ✗ | ✗ |
| Change role | ✓ | ✓ (≤ self) | ✗ | ✗ |
| Update group meta | ✓ | ✓ | ✗ | ✗ |
| Delete group | ✓ | ✗ | ✗ | ✗ |
| Invite link create | ✓ | ✓ | ✓ | ✓ (only own) |

V2: custom roles + per-channel permission override (Discord style).

---

## 6. Anti-abuse & moderation

### 6.1. Rate limit

- **Send message:** 5 msg / 10s / user / channel (Redis sliding window)
- **Voice connect:** 3 join/leave / minute (prevent rejoin spam)
- **React:** 30 reactions / minute
- **Invite create:** 10 invite / hour / user

### 6.2. Content moderation

- **Slow mode:** owner/admin set `slow_mode_seconds` per channel → user phải chờ giữa 2 message
- **Word filter:** V2 — auto-flag/delete tin nhắn chứa profanity (regex + AI)
- **Image moderation:** V2 — pass upload qua AI NSFW classifier trước khi accept
- **Anti-spam:** AI detect identical messages spammed → auto-mute 1h

### 6.3. Audit log

Reuse `audit_log` table (Phase 9). Log mọi action mod:
- `study_group.member.kick` { groupId, kickedUserId, by, reason }
- `study_group.member.ban`
- `study_group.message.delete` { messageId, by, content }
- `study_group.channel.delete` { channelId, by }

Owner xem `/groups/[id]/settings/audit` (V2).

---

## 7. Notification

### 7.1. In-app

- **Mention `@user`** → red dot trên group/channel + push notification (Phase M7)
- **`@everyone` / `@here`** → mod-only, notify all members
- **DM** (private message 1-1) — V2

### 7.2. Push notification (Phase M7)

- Mention → push title "{authorName} mentioned you in #{channelName}", body = message preview
- Voice channel invite (user A drag user B vào) — V2
- Honor user preference: `notification_preferences.studyGroup` boolean per group

### 7.3. Email digest (V3)

- Daily digest 7am — recap activity từ groups user joined
- Configurable in user settings

---

## 8. Performance & scale

### 8.0. Scale tiers — lộ trình từ MVP → big scale

| Tier | DAU | Concurrent | Msg/day | Voice min/mo | Stack | Cost/mo |
|---|---|---|---|---|---|---|
| **T1 MVP** | < 100 | 30 | 5K | 9K | Pusher free + LK Cloud free + Neon free | $0 |
| **T2 Growth** | 100–1K | 300 | 100K | 100K | Pusher $49 + LK Cloud $99 + Neon $19 | ~$170 |
| **T3 Scale** | 1K–10K | 3K | 1M | 1M | Soketi self-host + LK Cloud Scale + Neon Scale + Redis Cloud | ~$500 |
| **T4 Big** | 10K–100K | 30K | 10M | 10M | Soketi cluster + LK OSS multi-region + Citus shard + Redis Cluster + CDN | ~$3K |
| **T5 Mega** | > 100K | 300K+ | 100M+ | regional CDN | Cassandra/ScyllaDB shard + custom WebRTC SFU + Kafka events | $20K+ |

> **Architectural pivot points** giữa tiers:
> - T1 → T2: chỉ đổi env keys (vendor upgrade), code không sửa
> - T2 → T3: switch Pusher → Soketi (interface giống, env), thêm Redis cache layer
> - T3 → T4: schema partition + sharding + multi-region LiveKit SFU
> - T4 → T5: rewrite chat layer sang event-sourced (Kafka), CRDT, custom WebRTC

Plan này design **T1–T3 ready bằng env switch, T4 cần refactor có chủ đích** (documented dưới).

### 8.1. Database — partition + replica + index strategy

#### 8.1.1. Hot path indices (đã có trong schema)
- `study_group_message_channel_time_idx (channel_id, created_at)` — list messages của channel
- `study_group_channel_group_pos_idx (group_id, position)` — list channels của group
- `study_group_member_user_idx (user_id)` — list groups của user

#### 8.1.2. Partitioning `study_group_message` (T3+)
Khi message table > 50M rows (≈ 10GB), query single channel còn nhanh nhưng `VACUUM`, `pg_dump`, index rebuild chậm. Solution: **list partitioning by channel_id hash** hoặc **range by created_at**.

```sql
-- Time-based partition (T3, ~10M msg/month)
CREATE TABLE study_group_message (
  ... cols ...,
  created_at timestamp NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE TABLE study_group_message_2026_05 PARTITION OF study_group_message
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE study_group_message_2026_06 PARTITION OF study_group_message
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- BullMQ cron tạo partition tháng kế vào 25 mỗi tháng
```

Pros: query 1 channel chỉ touch 1-2 partition (recent + maybe last month). DROP cold partition trong < 1ms vs DELETE 10M rows mất giờ.

#### 8.1.3. Read replica routing (T2+)

`@cogniva/db` đã có `dbReplica` (xem `packages/db/src/index.ts`). Route study group queries:

| Query | Pool |
|---|---|
| List messages, members, channels (read) | `dbReplica` (lag 1-2s OK) |
| Send message, react, edit (write) | `db` (primary) |
| Read-your-own-write (message vừa send + reload) | `db` (force primary 5s sau write) |
| Mod action (kick, mute) | `db` |

Pattern: write → primary → invalidate Redis cache → next read hit cache (fresh) hoặc replica.

#### 8.1.4. Vector index cho semantic search (T3 — V2)

Khi user "search messages chứa concept X", PG FTS đủ (xem 8.5). Khi T3 muốn semantic — embed message bằng voyage-3, store `embedding vector(1024)` + HNSW index. Lazy embed: chỉ embed message > 50 chars trong channel có > 1K message.

### 8.2. Realtime fanout — Pusher → Soketi → cluster

#### 8.2.1. Fanout math

1 message send → fanout đến N concurrent subscribers. Cost ≈ N events.

| Scenario | Send/day | Avg subscribers | Fanout events/day |
|---|---|---|---|
| 30-user group, 50 msg/user/day | 1.5K | 30 | 45K |
| 100-user group, 100 msg/user/day | 10K | 100 | 1M |
| 1K-user group, 20 msg/user/day | 20K | 1K | 20M |

Pusher Cloud free: 200K/day → đủ scenario 1, vượt 2-3.

#### 8.2.2. T3 — Soketi self-host

Soketi protocol-compatible 100% với Pusher → switch chỉ cần đổi env `NEXT_PUBLIC_SOKETI_HOST` (đã wired trong `lib/realtime-server.ts` `lib/realtime-client.ts`). Self-host:

- Single VPS: 2 vCPU + 4GB RAM = ~10K concurrent WS
- Cost: $20/mo Hetzner CX22
- Sticky session qua Load Balancer (concept: user X luôn hit Soketi node Y vì subscription state in-memory)

#### 8.2.3. T4 — Soketi cluster với Redis pub/sub

10K → 100K concurrent: 1 node fail. Multi-node Soketi cluster:

```
Client → LoadBalancer (sticky by user) → [Soketi node A | B | C]
                                              ↓ subscribe state
                                          Redis pub/sub (shared)
                                              ↓ fanout
                                          Soketi node nhận msg trigger
                                              ↓ push WS
                                          Subscriber clients
```

- Redis Cluster cho pub/sub backbone
- 5 Soketi nodes × 10K concurrent = 50K
- Tổng cost: 5 × $20 + Redis Cluster $50 = $150/mo

#### 8.2.4. Event filtering server-side

V1 mỗi message broadcast TOÀN BỘ payload (content, attachments, mentions) đến mọi subscriber. T3+ tách:

- **Push event mỏng**: `{ channelId, messageId }` qua Pusher
- **Client fetch hydration**: GET /messages/[id] nếu chưa có trong cache local
- **Lợi**: fanout bandwidth giảm 10x, message dài (5KB) không phá quota Pusher

### 8.3. Cache layer — Redis hot data

Phase 19 đã có Redis (cogniva-redis Docker / Upstash REST / ioredis adapter). T2+ wire thêm:

#### 8.3.1. Cache schema

| Key pattern | Value | TTL | Use |
|---|---|---|---|
| `grp:{id}:channels` | JSON channel list | 5min | sidebar load |
| `grp:{id}:members` | JSON member list | 1min | member sidebar |
| `chn:{id}:recent50` | JSON last 50 msg | 30s | scroll initial load |
| `chn:{id}:unread:{uid}` | int count | 5min | badge |
| `usr:{uid}:groups` | JSON list groupIds | 5min | sidebar groups list |
| `voice:{chn}:participants` | Set userIds | 30s | participant stack |

Invalidation:
- Message send → DEL `chn:{id}:recent50` + INCR unread cho mỗi member chưa read
- Member join/leave → DEL `grp:{id}:members` + DEL `usr:{uid}:groups`
- Channel CRUD → DEL `grp:{id}:channels`

#### 8.3.2. Cache stampede protection

Multi tab cùng user reload → đồng loạt cache miss → 30 query DB. Mitigate qua **lock-aside**:

```typescript
// pseudo
async function getCached(key, ttl, loader) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  
  // Try set lock (NX + EX 10s) — only 1 process loads
  const locked = await redis.set(`lock:${key}`, '1', { nx: true, ex: 10 });
  if (locked === 'OK') {
    const fresh = await loader();
    await redis.set(key, JSON.stringify(fresh), { ex: ttl });
    await redis.del(`lock:${key}`);
    return fresh;
  }
  // Lost race — wait briefly + retry get
  await sleep(50);
  return JSON.parse(await redis.get(key)!);
}
```

Phase 19 Redis adapter đã có `set` với `nx` option — implementable ngay.

### 8.4. Search — PG FTS → Meilisearch → vector

#### 8.4.1. T1-T2: PostgreSQL full-text (Vietnamese)

```sql
ALTER TABLE study_group_message
  ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', unaccent(content))) STORED;

CREATE INDEX study_group_message_search_idx ON study_group_message USING GIN (search_tsv);
```

Vietnamese: dùng `simple` config + `unaccent` extension (gỡ dấu) → query "toan" match "Toán". Đủ cho < 1M messages.

Query: `WHERE search_tsv @@ websearch_to_tsquery('simple', $1) AND channel_id IN (...)` — RBAC filter sau FTS.

#### 8.4.2. T3+: Meilisearch index

PG FTS chậm khi join + filter member-can-see. Stream events sang Meilisearch:

```typescript
// On message send
inngest.send({ name: 'msg/indexed', data: { msgId, channelId, content, authorId } });
// Inngest function batch index 100 msg/sec
```

- Meilisearch self-host: 1 VPS 4GB RAM = ~100M docs index. $20/mo.
- Query latency: PG FTS ~200ms cho 10M rows, Meilisearch ~10ms.

#### 8.4.3. T4+ Hybrid: semantic + FTS

Wire voyage-3 embedding cho message > 50 chars → store vector. Search:
1. FTS keyword match → top 200
2. Vector cosine với query embedding → rerank top 20
3. Cohere rerank-3 → top 10 final

Tái dùng pattern `/api/search` hiện có của Cogniva (RAG).

### 8.5. Attachments — R2 + CDN + image transcode

#### 8.5.1. Upload flow (T2+)

```
1. Client request POST /api/uploads/sign → returns presigned R2 PUT URL
2. Client PUT file directly to R2 (bypass Next.js server — đỡ tải)
3. Client POST /messages với attachment.url = R2 public URL
```

#### 8.5.2. Image transcode pipeline (T3+)

User upload 10MB JPEG → CDN serve full size = waste bandwidth. Wire Cloudflare Images hoặc imgproxy:

```
Original: r2://msg-attachments/abc123.jpg (10MB)
↓ Cloudflare Image Resizing on-the-fly
- thumb_100w: 5KB (avatar list)
- preview_400w: 50KB (message inline)
- full: 10MB (click expand)
```

CDN cache → subsequent loads hit edge, không touch R2 (saving egress cost).

#### 8.5.3. Video & audio (V3)

- Video transcode async qua FFmpeg worker (BullMQ) → multi-bitrate
- Audio: chuyển opus 64kbps cho voice clip (giảm 80%)

### 8.6. Voice infrastructure — LiveKit scale

#### 8.6.1. T2-T3 — LiveKit Cloud paid

| Tier | $/mo | min/mo | concurrent | rooms |
|---|---|---|---|---|
| Build | $0 | 10K | 100 | unlimited |
| Ship | $50 | 50K | 500 | unlimited |
| Scale | $300 | 500K | 5K | unlimited |
| Enterprise | custom | unlimited | unlimited | unlimited |

Switch chỉ đổi env `LIVEKIT_URL` + API keys.

#### 8.6.2. T4 — Self-host LiveKit OSS multi-region

LiveKit là SFU OSS (Apache 2.0). Self-host khi:
- > 1M min/mo (cost cloud > self-host)
- Cần region custom (Asia → SG/HCMC node giảm latency)

Architecture:
```
Client ── join token ──→ Cogniva backend
                              ↓ gen LiveKit JWT
Client ── connect WS ──→ LiveKit Edge (SG/SF/EU)
                              ↓ SFU forwards media
Other clients ←──── selected forwarding ───┘
```

- 1 LiveKit node: 4 vCPU + 16GB → ~200 concurrent participants
- Multi-region: 3 nodes × $80/mo = $240
- Redis for room state sync giữa region

#### 8.6.3. Voice quality adaptive

Khi LiveKit detect bandwidth < 200kbps:
- Force audio-only (no video)
- Mono 16kHz Opus
- Disable simulcast
- Notify user "Mạng yếu — đã chuyển audio-only"

Server-side hint qua LiveKit metadata API.

### 8.7. Queue & event bus — BullMQ → Kafka

#### 8.7.1. Hai loại workload tách biệt

| Loại | Latency yêu cầu | Volume | Tool T1-T3 | Tool T4+ |
|---|---|---|---|---|
| **Realtime broadcast** (msg → subscribers) | < 100ms | High (fanout × N) | Pusher/Soketi direct | Soketi + Redis pub/sub |
| **Async job** (index, notify, cleanup) | < 5s OK | Medium | BullMQ jobs | Kafka + worker pool |

KHÔNG dồn cả 2 vào 1 hệ thống — broadcast cần in-memory fast path, job cần durable retry.

#### 8.7.2. BullMQ jobs catalog (T1-T3)

Phase M7 đã có BullMQ. Study group thêm:

| Event | Trigger | Job | Priority | Concurrency |
|---|---|---|---|---|
| `msg/created` | POST /messages | Index Meilisearch + extract mentions | high | 50 |
| `msg/mentioned` | Mention parsed | Push notification fanout (qua Phase M7 pipeline) | urgent | 100 |
| `msg/cleanup-soft-deleted` | Cron daily 3am | DELETE rows có deletedAt > 30d (10K batch) | low | 1 |
| `grp/partition-create` | Cron monthly 25th | CREATE partition tháng kế | low | 1 |
| `voice/participant-joined` | LiveKit webhook | UPSERT voice_state + broadcast presence | high | 200 |
| `voice/session-ended` | LiveKit webhook | Aggregate stats → analytics + audit_log | normal | 20 |
| `grp/digest-email` | Cron daily 7am | Send digest email per user (V3) | low | 10 |
| `grp/member-invited` | POST /invites used | Send welcome message + audit | normal | 30 |
| `attachment/uploaded` | R2 webhook | Image resize + AI NSFW scan (V2) | normal | 20 |
| `gdpr/user-deleted` | Better Auth delete | Cascade purge user msg + voice_state | low | 5 |

Inngest config:
- **Concurrency limit per fn** — tránh DB overload (max 200 fn run đồng thời cho msg/created)
- **Retry**: exponential backoff 4 lần (1s, 10s, 1min, 10min), fail → DLQ
- **Throttle**: rate-limit per user key (vd `msg/mentioned` throttle 10/min/user để chống spam push)
- **Idempotency key**: dùng `messageId` cho `msg/created`, `webhookId` cho LiveKit events

#### 8.7.3. Outbox pattern — reliable broadcast

**Problem:** message POST flow hiện tại:
```
1. INSERT message into DB    ← txn commit
2. Pusher trigger broadcast  ← network call AFTER commit
```
Step 2 fail (Pusher down 3s, network blip) → message lưu DB nhưng KHÔNG broadcast → user khác miss.

**Solution outbox pattern (T2+):**

```typescript
// 1. Trong cùng transaction
await db.transaction(async (tx) => {
  await tx.insert(studyGroupMessage).values(msg);
  await tx.insert(outboxEvent).values({
    type: 'msg/broadcast',
    payload: { channelId, messageId },
    status: 'pending',
  });
});

// 2. Separate worker (Inngest cron mỗi 1s)
const pending = await db.select().from(outboxEvent)
  .where(and(eq(outboxEvent.status, 'pending'), lte(outboxEvent.attemptCount, 5)))
  .limit(100);

for (const evt of pending) {
  try {
    await triggerEvent(`private-channel-${evt.payload.channelId}`, 'message:new', ...);
    await db.update(outboxEvent).set({ status: 'sent', sentAt: now() }).where(...);
  } catch {
    await db.update(outboxEvent).set({
      attemptCount: evt.attemptCount + 1,
      lastError: err.message,
    }).where(...);
  }
}
```

Bảng mới:
```sql
CREATE TABLE outbox_event (
  id text PRIMARY KEY,
  type text NOT NULL,           -- 'msg/broadcast', 'notification/push', ...
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp NOT NULL DEFAULT now(),
  sent_at timestamp
);
CREATE INDEX outbox_pending_idx ON outbox_event(status, created_at) WHERE status = 'pending';
```

Lợi:
- Guarantee at-least-once delivery — message KHÔNG bao giờ mất broadcast
- Crash recovery — restart worker resume từ outbox
- Trade-off: thêm 1 query/message + latency broadcast 1-2s (acceptable cho group chat, KHÔNG cho voice signaling)

#### 8.7.4. Priority queue

Inngest hỗ trợ priority qua function-level `concurrency.limit` + `priority.run` expression:

```typescript
inngest.createFunction(
  {
    id: 'msg-mentioned',
    concurrency: { limit: 100, key: 'event.data.targetUserId' },
    priority: { run: 'event.data.priority' },  // urgent | normal | low
  },
  { event: 'msg/mentioned' },
  async ({ event, step }) => { ... }
);
```

Convention:
- **urgent** — mention notification, voice presence (user-facing realtime)
- **normal** — index, audit log, member welcome
- **low** — cleanup, digest, partition maintenance

#### 8.7.5. Dead letter queue (DLQ)

Sau 4 retry, Inngest mark fn run là `failed`. T3+ wire alert:

```typescript
// inngest/functions/dlq-handler.ts — chạy khi any fn fail
inngest.createFunction(
  { id: 'dlq-handler' },
  { event: 'inngest/function.failed' },
  async ({ event }) => {
    await db.insert(dlqEntry).values({
      fnName: event.data.function_id,
      eventData: event.data.event,
      error: event.data.error,
      failedAt: new Date(),
    });
    // Alert Slack/Sentry nếu critical (msg/created, voice/* events)
    if (CRITICAL_EVENTS.has(event.data.function_id)) {
      await sendSlackAlert(`Inngest DLQ: ${event.data.function_id}`);
    }
  }
);
```

Owner ops xem `/admin/dlq` (V3) → manual replay sau khi fix bug.

#### 8.7.6. T4 — Kafka migration

Khi T4 (>10M events/day):
- Inngest Cloud pricing cao (~$0.001/run × 10M = $10K/mo)
- Self-host Inngest possible nhưng complexity tương đương Kafka

**Migration path:**
1. Producer side đổi `inngest.send()` → `kafka.produce(topic, payload)` qua thin wrapper
2. Consumer: viết worker Node.js subscribe Kafka topic → process → commit offset
3. Outbox worker đổi target Pusher → Kafka topic `realtime-fanout` → Soketi nodes subscribe + push WS

Kafka topology:
```
Topics:
  - msg.created       (partitioned by channelId, 32 partitions)
  - msg.mentioned     (partitioned by targetUserId, 16 partitions)
  - voice.events      (partitioned by channelId, 8 partitions)
  - audit.log         (single partition, ordered)
  - dlq               (single partition for failed events)

Consumers (worker pools):
  - indexer × 3       (Meilisearch updater)
  - notifier × 5      (push notification fanout)
  - analytics × 2     (aggregator)
  - mod-scanner × 2   (NSFW, profanity, link safety)
```

Kafka cluster: 3 brokers × 4 vCPU = ~$120/mo (Hetzner) hoặc Confluent Cloud $1/GB.

#### 8.7.7. Idempotency at scale

Mọi consumer phải idempotent — Kafka at-least-once, Inngest cũng vậy → 1 event có thể được process 2 lần.

Pattern:
```typescript
// Indexer fn
async function indexMessage(event) {
  const { messageId } = event.data;
  // Check đã index chưa
  const existing = await meilisearch.getDocument(messageId).catch(() => null);
  if (existing && existing._version >= event.data.version) {
    return { skipped: true, reason: 'already-indexed' };
  }
  await meilisearch.addDocuments([...]);
}
```

Mọi event payload include `version` (incrementing timestamp ms) — consumer compare để skip stale.

### 8.8. Rate limit — distributed sliding window

Phase M4 đã có rate-limit qua Redis. Wire cho group endpoints:

| Action | Limit | Key |
|---|---|---|
| Send message | 5 / 10s | `rl:msg:{uid}:{channelId}` |
| Voice connect | 3 / 60s | `rl:voice:{uid}` |
| React toggle | 30 / 60s | `rl:react:{uid}` |
| Invite create | 10 / 3600s | `rl:invite:{uid}` |
| Channel create | 5 / 3600s | `rl:chn-create:{uid}` |
| Mention `@everyone` | 1 / 60s | `rl:mention-all:{groupId}` |

Sliding window via ZADD timestamp + ZREMRANGEBYSCORE oldest. Edge case: clock skew giữa node — accept 1-2s slop.

### 8.9. Monitoring & SLO

#### 8.9.1. Key metrics (PostHog + custom)

- **Message send latency P50/P95/P99** — alert P95 > 500ms
- **WebSocket reconnect rate** — alert > 5% over 5min
- **LiveKit room failure rate** — alert > 1%
- **Cache hit rate** — alert < 70%
- **DB slow query** — alert any query > 1s
- **Pusher quota usage** — alert > 80%
- **LiveKit minute usage** — alert > 80%

#### 8.9.2. SLO targets (T3+)

- Message send → broadcast P95 < 300ms
- Voice connect success rate > 99%
- 99.9% uptime cho chat (8.7h downtime/year)
- 99.5% cho voice (44h/year — degrade gracefully)

#### 8.9.3. Dashboards

- Grafana board mỗi: chat throughput, voice rooms active, error rate per endpoint
- Sentry Performance + Replay cho debug
- Vercel Analytics cho frontend Web Vitals

### 8.10. Cost model & break-even

| Tier | Pusher/Soketi | LiveKit | DB | Redis | CDN | **Total/mo** | $/user |
|---|---|---|---|---|---|---|---|
| T1 (100 users) | $0 (Pusher free) | $0 (LK free) | $0 (Neon free) | $0 (Upstash free) | $0 | **$0** | $0 |
| T2 (1K users) | $49 (Pusher) | $99 (LK Ship) | $19 (Neon) | $0 (Upstash free) | $5 (CF) | **$172** | $0.17 |
| T3 (10K users) | $20 (Soketi VPS) | $300 (LK Scale) | $100 (Neon Scale) | $30 (Redis) | $20 (CF) | **$470** | $0.05 |
| T4 (100K users) | $150 (Soketi cluster) | $240 (LK self-host) | $500 (Aurora/Citus) | $100 (Redis Cluster) | $100 (CF Pro) | **$1,090** | $0.011 |

**Break-even points:**
- Pusher → Soketi: 5K active concurrent users (Pusher $99 > Soketi VPS $20)
- LK Cloud → LK self-host: 1.5M min/mo
- Neon → Aurora/Citus: > 100GB hot data + > 1K QPS

**Revenue assumption** (V3+):
- Free: 1 group, 30 members, 10MB attachments — covers T1 acquisition
- Pro $5/mo: unlimited groups, 100 members/group, 1GB attachments
- Team $20/mo per group: 500 members, custom branding, audit log, priority support
→ Break-even Pro: 35 paying users cover T2 cost

### 8.11. Data lifecycle & GDPR

- **Hot tier**: < 90 ngày — full indexed, Redis cached, primary DB
- **Warm tier**: 90 ngày — 1 năm — replica only, no Redis cache, no FTS index (V3)
- **Cold tier**: > 1 năm — S3 Glacier compressed JSON dump (V3+)
- **User delete** (GDPR): cascade hard delete → existing pipeline Phase 9 `processGdprDeletion` extend cho `study_group_message`, `study_group_voice_state`

### 8.12. Refactor checklist khi pivot T3 → T4

Khi DAU vượt 10K, plan này hỗ trợ tới T3 không sửa code. T4 cần touchpoints:

- [ ] Schema partition `study_group_message` by date (script + Inngest cron tạo partition)
- [ ] Soketi cluster setup + Redis pub/sub backbone + sticky session LB
- [ ] LiveKit self-host SFU multi-region + Redis room state sync
- [ ] Switch DB Neon → Aurora hoặc Citus (hash shard by groupId)
- [ ] Cache layer Redis Cluster (3 master + 3 replica)
- [ ] Cloudflare CDN proxy front cho R2 attachments
- [ ] Meilisearch index search (kèm Inngest indexer fn)
- [ ] Event filter "thin payload" (send messageId, client fetch hydration)
- [ ] Monitoring & SLO dashboard
- [ ] Cost optimization audit hàng quý

---

## 9. Migration & backward compatibility

### 9.1. Migration `0011_study_group_channels.sql`

```sql
-- 1. ALTER study_group thêm icon/banner/maxMembers
ALTER TABLE study_group
  ADD COLUMN IF NOT EXISTS icon_url text,
  ADD COLUMN IF NOT EXISTS banner_url text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_members integer NOT NULL DEFAULT 100;

-- 2. Mở rộng group_role enum
ALTER TYPE group_role ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE group_role ADD VALUE IF NOT EXISTS 'MODERATOR';

-- 3. ALTER study_group_member
ALTER TABLE study_group_member
  ADD COLUMN IF NOT EXISTS nickname text,
  ADD COLUMN IF NOT EXISTS muted_until timestamp,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamp;

-- 4. Enum channel_type
DO $$ BEGIN
  CREATE TYPE channel_type AS ENUM ('TEXT', 'VOICE', 'ANNOUNCEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. study_group_channel
CREATE TABLE IF NOT EXISTS study_group_channel (
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES study_group(id) ON DELETE CASCADE,
  name text NOT NULL,
  type channel_type NOT NULL,
  topic text,
  position integer NOT NULL DEFAULT 0,
  is_private boolean NOT NULL DEFAULT false,
  slow_mode_seconds integer,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  livekit_room_name text,
  voice_max_participants integer
);
CREATE INDEX IF NOT EXISTS study_group_channel_group_pos_idx ON study_group_channel(group_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS study_group_channel_livekit_idx ON study_group_channel(livekit_room_name) WHERE livekit_room_name IS NOT NULL;

-- 6. study_group_message
CREATE TABLE IF NOT EXISTS study_group_message (
  id text PRIMARY KEY,
  channel_id text NOT NULL REFERENCES study_group_channel(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  content text NOT NULL,
  content_type text NOT NULL DEFAULT 'markdown',
  reply_to_id text,
  attachments jsonb,
  reactions jsonb,
  pinned boolean NOT NULL DEFAULT false,
  mentions jsonb,
  edited_at timestamp,
  deleted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_group_message_channel_time_idx ON study_group_message(channel_id, created_at);
CREATE INDEX IF NOT EXISTS study_group_message_author_idx ON study_group_message(author_id);

-- 7. study_group_read_state
CREATE TABLE IF NOT EXISTS study_group_read_state (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES study_group_channel(id) ON DELETE CASCADE,
  last_read_message_id text,
  muted boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

-- 8. study_group_invite
CREATE TABLE IF NOT EXISTS study_group_invite (
  id text PRIMARY KEY,
  group_id text NOT NULL REFERENCES study_group(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  expires_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS study_group_invite_group_idx ON study_group_invite(group_id);

-- 9. study_group_voice_state (1 user chỉ trong 1 voice)
CREATE TABLE IF NOT EXISTS study_group_voice_state (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  channel_id text NOT NULL REFERENCES study_group_channel(id) ON DELETE CASCADE,
  joined_at timestamp NOT NULL DEFAULT now(),
  self_muted boolean NOT NULL DEFAULT false,
  server_muted boolean NOT NULL DEFAULT false,
  camera boolean NOT NULL DEFAULT false,
  screen_share boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS study_group_voice_state_channel_idx ON study_group_voice_state(channel_id);

-- 10. Auto-tạo #chung channel + admin role cho group cũ
-- Cho mỗi group đã tồn tại, tạo 1 TEXT channel "chung" với owner làm createdBy.
INSERT INTO study_group_channel (id, group_id, name, type, position, created_by)
SELECT
  'auto-' || g.id,
  g.id,
  'chung',
  'TEXT',
  0,
  g.owner_user_id
FROM study_group g
WHERE NOT EXISTS (SELECT 1 FROM study_group_channel WHERE group_id = g.id);
```

### 9.2. Backward compat với `studyGroup.inviteCode`

- Giữ cột `inviteCode` cho legacy link, hoặc migrate qua bảng mới + drop sau 1 release
- Endpoint `POST /api/groups/join` accept cả `code` từ `studyGroupInvite.code` HOẶC legacy `studyGroup.inviteCode`

---

## 10. Implementation batches

### Batch A — Schema + foundations (~1 ngày)
- [ ] Migration `0011_study_group_channels.sql` applied
- [ ] Drizzle schema export + relations + types
- [ ] Helper `lib/group/permissions.ts` — check role can do action
- [ ] Helper `lib/group/code.ts` — gen 8-char invite code

### Batch B — Channel CRUD + group settings (~1 ngày)
- [ ] APIs: `/api/groups/[id]/channels` GET/POST/PUT/DELETE + reorder
- [ ] APIs: `/api/groups/[id]/invites` CRUD
- [ ] APIs: `/api/groups/[id]/members` PUT role/nickname + DELETE kick/leave
- [ ] UI: `/groups/[id]/settings/{members,channels,invites}` pages

### Batch C — Text channel chat (~2 ngày)
- [ ] APIs: `/api/channels/[id]/messages` GET (cursor) + POST + PUT + DELETE
- [ ] APIs: `/api/channels/[id]/messages/[msgId]/react`
- [ ] APIs: `/api/channels/[id]/read`
- [ ] Realtime: Socket.IO channel `private-channel-{id}` + auth extension
- [ ] UI: `message-list`, `message-item`, `message-composer`, `markdown-render`
- [ ] UI: `unread-badge`, `typing-indicator`
- [ ] Rate limit + slow mode

### Batch D — Voice channel (~1 ngày)
- [ ] API: `/api/channels/[id]/voice/token` — gen LiveKit JWT
- [ ] Webhook: `/api/webhooks/livekit-group` — sync voice_state
- [ ] Realtime: `presence-voice-{channelId}` channel auth
- [ ] UI: `voice-channel-view` (LiveKit grid) + `voice-control-bar`
- [ ] UI: participant avatar stack trong channel sidebar

### Batch E — Group UI shell (~1 ngày)
- [ ] Layout `/groups/[id]/layout.tsx` — 3-col Discord
- [ ] `group-sidebar` + `channel-list` + `member-sidebar`
- [ ] Routing `/groups/[id]/[channelId]` + redirect default channel
- [ ] Mobile responsive — collapse sidebars to bottom drawer

### Batch F — Moderation + notifications (~1 ngày)
- [ ] Mute/kick/ban member actions + UI confirm
- [ ] Audit log entries cho mod actions
- [ ] Mention parser + notify (push qua Phase M7 pipeline)
- [ ] Slow mode UI control trong channel settings

### Batch G — Polish (~0.5 ngày)
- [ ] Emoji picker (re-use existing chat component nếu có)
- [ ] Reply chip + jump-to-original
- [ ] Reaction picker + hover detail
- [ ] PWA notification permission flow
- [ ] Smoke test E2E: 2 browser test chat + voice

**Tổng:** ~7-8 ngày dev. Có thể parallel A+B vs C+D+E nếu 2 dev.

---

## 11. Acceptance criteria (Phase 20 V1 done)

- [ ] Owner tạo group → tự động có `#chung` TEXT channel + invite code
- [ ] Owner tạo invite link (max 10 uses, expires 7 ngày) → share student → student dán code vào `/groups/join` → join thành công
- [ ] Owner tạo channel "toán" TEXT + "Phòng Toán" VOICE
- [ ] Student vào `/groups/[id]/[channelId]` thấy 3-col layout với channel list + messages + member list
- [ ] 2 student gửi tin nhắn → cả 2 cùng thấy realtime qua Socket.IO (< 500ms latency)
- [ ] Student click voice channel → LiveKit token gen → join → audio/video work qua 4G
- [ ] Mod xoá tin nhắn vi phạm → message UI cập nhật realtime cho mọi client
- [ ] Student rời tab, quay lại → unread badge hiện số message mới
- [ ] Mention `@user` → user nhận push notification (Phase M7 wired)

---

## 12. Tech notes & gotchas

### 12.1. Why không reuse `room` cho voice channel?

- `room` thiết kế cho **ephemeral standalone rooms** (Phase 13) — owner, joinCode, scheduledStart, recurring. Mỗi room độc lập.
- Voice channel trong group là **persistent fixture** — luôn tồn tại trong group, không có owner riêng, không scheduled.
- Tách `studyGroupChannel` clean hơn — voice channel chỉ là 1 LiveKit room name + metadata, không cần full lifecycle như standalone `room`.

### 12.2. Why không reuse `roomMessage` cho group chat?

- `roomMessage` tied to `room` (FK → room.id). Group chat tied to channel (FK → study_group_channel.id).
- Tách `studyGroupMessage` để cho phép message format mới (reactions, threading, attachments) mà không phá schema existing roomMessage.
- Migration cost nếu reuse: ALTER roomMessage thêm cột reactions/replyTo/... + thay đổi FK polymorphism — phức tạp.

### 12.3. PostgreSQL JSONB cho reactions

- `reactions: { '👍': ['userId1', ...], ...}` — array của userId per emoji
- Toggle reaction: UPDATE qua jsonb_set + jsonb_array_append/remove (1 query atomic)
- Hot key: `WHERE id = X` lookup nhanh; query "messages I reacted to" cần GIN index → V2

### 12.4. Soft-delete message

- `deletedAt` set thay vì DELETE row → giữ thread context (reply chain)
- UI render "Tin nhắn đã xoá" placeholder
- Hard delete sau 30 ngày qua BullMQ cron (GDPR compliant)

### 12.5. LiveKit Cloud quota

- Free tier 10K participant-min/mo — 1 group active 10 user × 30 min × 30 day ≈ 9K min
- Monitor `/health` báo warning khi đạt 80% → đề nghị upgrade
- Voice-only mode (mute camera default) tiết kiệm bandwidth + quota

### 12.6. Pusher Cloud limits

- 100 concurrent → 100 user online cùng lúc trong tất cả groups
- 200K msg/day → tính cả fanout. 1 send + 30 receiver = 31 events. 6500 message/day max trong scenario 30-người group
- Khi vượt: upgrade Pusher ($20/mo) hoặc switch self-hosted Soketi

### 12.7. Anti-cheat trong study group context

- Group là social space → KHÔNG áp dụng anti-cheat như exam
- Có optional "Quiet Hours" — owner config group im lặng 23h-6h, notification mute auto

---

## 13. Out of scope (V2+)

- **Threads** (Discord-style sub-conversation trong message) — V2 ✅
- **DM** (private 1-1 message) — V2 ✅
- **Categories** (group of channels) — V2 ✅
- **Custom roles + per-channel permission overrides** — V2
- **Voice recording + transcript** — V3 ✅ (migration 0016 + `/api/channels/[id]/record` + `/groups/recordings/[recId]`)
- **Stage channels** (audience + speakers) — V3 ✅ (migration 0019 + `study_group_stage_role` table + raise-hand/promote/demote + `StageChannel` UI)
- **Forum channels** — V3 ✅ (migration 0020 + `study_group_message.title/tags` + `study_group_channel.available_tags` + `/api/channels/[id]/forum` list + `ForumChannel` UI với post cards + tag filter + TagManagerDialog)
- **LMS LTI 1.3** — V3 ⏸️ (hoãn — feature enterprise, sẽ làm khi có nhu cầu thật từ trường)
- **Server boost / nitro features** — không apply
- **Bots / webhooks** — V3
- **Video calls > 50 người** — không scope, dùng dedicated `room` Phase 13

---

## 14. Risk register

### 14.1. Functional risks
| Risk | Severity | Mitigation |
|---|---|---|
| Race condition trong reaction toggle | Medium | Upsert qua atomic UPDATE với CHECK trong WHERE clause |
| Mod xoá nhầm message | Low | Soft delete + 7-day undo window, audit log immutable |
| Mention notification spam | Medium | Rate limit `@everyone` 1/min/group, opt-out per channel |
| Mobile WebRTC fail trên 3G yếu | Medium | Voice-only fallback + reconnect 3 retry + degrade audio quality |
| Webhook LiveKit drop → voice_state stale | Medium | BullMQ cron mỗi 5 min reconcile state từ LiveKit list API |

### 14.2. Scale risks
| Risk | Trigger | Mitigation |
|---|---|---|
| Pusher free hit limit | > 200K msg fanout/day | Auto-alert 80%, switch Soketi self-host (1 day work, env-only) |
| LiveKit quota exhaust | > 10K min/mo | Voice-only mode + upgrade LK Ship $50/mo |
| DB message table > 50M rows | T3 onset (~1M msg/month) | Partition by created_at month, drop cold partition |
| Cache hit rate < 50% | Hot channel re-render storm | Cache stampede protection (lock-aside pattern) |
| WebSocket disconnect cascade | LB sticky session fail | Redis pub/sub backbone giữ state cross-node |
| Search latency > 2s | > 5M messages PG FTS | Switch Meilisearch async indexer |
| CDN egress cost spike | Attachment hot viral | Cloudflare CDN cache 90% + image resize |
| Voice latency > 300ms | Cross-region | Self-host LiveKit SFU per region (SG/SF/EU) |
| Single Soketi node OOM | > 10K concurrent WS | Cluster 5 nodes + sticky session LB |
| GDPR delete chain timeout | User delete với 100K msg | Async qua BullMQ worker, retry idempotent |

### 14.2b. Queue & event bus risks
| Risk | Trigger | Mitigation |
|---|---|---|
| Pusher broadcast fail → message persist nhưng KHÔNG fanout | Network blip giữa DB write + Pusher trigger | **Outbox pattern** (8.7.3) — guarantee at-least-once |
| Inngest cost spike T4 | > 5M event/day × $0.001 | Migrate Kafka self-host (~$120/mo) |
| Duplicate side-effect (push noti × 2) | At-least-once consumer | Idempotency key + version compare (8.7.7) |
| DLQ silent failure | Critical event fail không ai biết | DLQ handler fn alert Slack/Sentry cho CRITICAL_EVENTS set |
| Outbox table bloat | Worker fail → pending events accumulate | Cron purge sent rows > 7 days + alert pending > 10K |
| Hot partition Kafka (1 channel 90% traffic) | Skewed group activity | Re-partition message topic by `hash(channelId + bucket)` thay vì pure channelId |
| Consumer lag tăng | Slow Meilisearch / push API | Auto-scale worker replicas + back-pressure (pause produce nếu lag > 60s) |
| Cron partition-create skip | Inngest down ngày 25 | Idempotent: re-run cron 26, 27 cũng OK; alert nếu tháng kế chưa có partition vào ngày 30 |
| Event order mismatch (msg edit trước create deliver) | Multi-partition + parallel consumer | Order key = messageId trong partition; consumer dedupe theo version |

### 14.3. Abuse risks
| Risk | Mitigation |
|---|---|
| Spam khi public invite | Rate limit invite create + email verification gate trước join |
| Coordinated harassment | Per-user block list + mod kick + ban IP optional |
| NSFW attachment upload | V2 AI NSFW classifier pre-accept (Cohere Vision hoặc Replicate) |
| Bot signup massive group join | Cloudflare Turnstile captcha + rate limit `/api/groups/join` |
| Voice channel DDoS qua join spam | Rate limit voice connect 3/min/user, IP-based 10/min |
| Crypto/scam link in messages | URL filter blocklist + AI link safety scan async |

### 14.4. Compliance risks
| Risk | Mitigation |
|---|---|
| COPPA — < 13 yo trong group adult | Tận dụng existing `coppa-pending` flow, parent consent gate trước join |
| GDPR — message retention forever | Soft delete 30 ngày + hard delete cold tier 1 năm + user export endpoint |
| Vietnam cybersecurity law (data localization V3) | Sẵn sàng deploy DB region VN khi user > 1K |
| Audit log mutation | Append-only audit_log table + cryptographic hash chain (V3) |
| Cross-border data export EU users | Standard Contractual Clauses (SCC) khi Pusher/LK Cloud US |

---

---

## 15. Integration với Cogniva ecosystem + external systems

> Study group KHÔNG đứng một mình — phải sync với 12+ feature hiện có của Cogniva (documents, flashcards, mastery, AI tutor, exam, notifications, audit, GDPR…) và mở cho external systems (Slack, calendar, LMS, webhook). Section này define những integration point cần wire ngay từ V1 để tránh refactor về sau.

### 15.1. Internal integration map

```
        ┌─────────────────────────────────────────────────┐
        │              Study Group                         │
        │   (channels, messages, voice, members)           │
        └──┬──────────┬──────────┬──────────┬─────────────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
    ┌──────────┐ ┌─────────┐ ┌────────┐ ┌──────────────┐
    │Documents │ │Flashcards│ │ Exams  │ │ Knowledge    │
    │ + Chunks │ │ + Reviews│ │ + Attempts│Graph + Concept│
    └──────────┘ └─────────┘ └────────┘ └──────────────┘
           │          │          │          │
           ▼          ▼          ▼          ▼
    ┌────────────────────────────────────────────────────┐
    │  Shared infrastructure                              │
    │  - AuditLog · Notifications · Search · AI Tutor    │
    │  - GDPR pipeline · Analytics · Mastery aggregator  │
    └────────────────────────────────────────────────────┘
```

### 15.2. Internal integration points (12 feature)

#### 15.2.1. Documents & Notes (Phase 1-2)
**Use case:** Share document Cogniva trong group chat.
- Message attachment type mới: `{ type: 'cogniva_doc', documentId, title, snippet }`
- Render trong message → preview card với link mở `/documents/[id]` 
- Permission check: viewer phải có access document (workspace member hoặc public doc)
- API: `POST /api/channels/[id]/messages` accept `documentRefs: [docId]` → server resolve + validate access trước khi insert

#### 15.2.2. Flashcards (Phase 6)
**Use case:** Share deck flashcards trong channel để cả lớp luyện chung.
- Mới: `study_group_shared_deck` link table (channelId, deckId, sharedBy, sharedAt)
- Channel sidebar có tab "Decks" → list deck đã share trong channel này
- Click → fork deck vào my decks (no edit gốc) hoặc study live
- API: `POST /api/channels/[id]/decks` body { deckId }

#### 15.2.3. Exams (Phase 16)
**Use case:** Share exam code trong channel để cả nhóm cùng làm.
- Khi message content match regex `^EXAM-[A-Z0-9]{6}$` → auto-render exam card với title + mode + Start button
- Tạo bảng `study_group_shared_exam` (channelId, examId) để track + analytics
- **Group leaderboard:** GET `/api/groups/[id]/exams/[examId]/leaderboard` → top score của members trong group này (filter examAttempt.userId ∈ group members)

#### 15.2.4. Knowledge Graph + Concept (Phase 8)
**Use case:** Message mention concept `[[Đạo hàm]]` → pill link tới concept page + auto-link mastery.
- Markdown render: `[[X]]` → fetch concept by name → render pill với link `/graph?concept=X`
- Khi user gõ tin nhắn có `[[concept]]` → server parse + INSERT `study_group_message_concept` link table (channelId, messageId, conceptId)
- Analytics: top 10 concept được discuss nhiều nhất trong group → trending topics widget

#### 15.2.5. AI Tutor (Phase 7)
**Use case:** Summon AI vào channel — `@AI giải thích bài 3.4`.
- Mention parser detect `@AI` → enqueue BullMQ job `ai/tutor-respond`
- AI fn:
  - Load 50 message context cuối channel (group conversation)
  - Load shared documents trong channel
  - Generate response qua `routedGenerateText({ useCase: 'tutor' })`
  - POST reply qua bot user (system user `ai-bot`) → broadcast như message thường
- Cost: count vào group owner's AI quota (V3 add billing per group)

#### 15.2.6. Notifications (Phase M7)
**Use case:** Mention → push notification mobile.
- Mention parser → enqueue BullMQ job `msg/mentioned` ({ targetUserId, ... })
- Notification fn:
  - Load `pushToken` của user
  - Check `notification_preferences.studyGroup` của user (opt-out per group)
  - Check user là member ACTIVE channel này
  - Send Expo Push với deep link `cogniva://groups/[id]/[channelId]?msg=[msgId]`
- Reuse Phase M7 pipeline + `notification_log` table

#### 15.2.7. Audit Log (Phase 9)
**Use case:** Mọi mod action → append immutable log.
- Action: `study_group.channel.create`, `.delete`, `.member.kick`, `.member.ban`, `.message.delete`, `.role.change`
- Schema: `audit_log` table đã tồn tại — extend `entityType` enum thêm `study_group`, `study_group_channel`, `study_group_message`
- Owner xem `/groups/[id]/settings/audit` (V2) → filter by action type + actor + date

#### 15.2.8. GDPR pipeline (Phase 9)
**Use case:** User request delete account → cascade purge data study group.
- Extend `processGdprDeletion` BullMQ job:
  - `study_group_message`: anonymize `authorId → 'deleted-user'` + content → "[Tin nhắn đã xoá]". KHÔNG hard delete vì sẽ break replies + thread context. (Discord's approach)
  - `study_group_voice_state`: hard delete
  - `study_group_member`: hard delete row
  - `study_group_invite` (createdBy): set createdBy = null
  - Nếu user là OWNER của group → 2 option: transfer ownership cho admin có rank cao nhất, hoặc archive group
- Test idempotent (re-run safe)

#### 15.2.9. Mastery aggregation (Phase 6)
**Use case:** Group dashboard → "Concepts cả lớp đang yếu nhất".
- BullMQ cron `grp/mastery-aggregate` mỗi 6h:
  - Cho mỗi group: aggregate `mastery` rows của tất cả members
  - Tìm top 10 concept có average mastery thấp nhất trong group
  - Store vào `study_group_analytics_daily` (groupId, date, weakConcepts jsonb, strongConcepts jsonb, avgEngagement)
- UI: `/groups/[id]/insights` (V2) → biểu đồ + action button "Sinh quiz từ concept yếu"

#### 15.2.10. Search (Phase 4)
**Use case:** Unified search Ctrl+K — tìm messages + documents + concepts + members.
- Extend `/api/search` endpoint accept `entityTypes: ['document', 'message', 'concept', 'member']`
- Indexer: Meilisearch index riêng `messages` collection với filter `channel_id IN (user's accessible channels)`
- RBAC filter at search time — user chỉ search được message của group họ là member ACTIVE

#### 15.2.11. Recordings (Phase 15) — ✅ V3 shipped
**Use case:** Voice channel record session → playback sau.
- Reuse LiveKit egress pipeline đã có (Phase 15) — chỉ cần wire UI button "Record" trong voice channel
- LiveKit recording → R2 → BullMQ `process-recording` extract audio → Whisper transcript → tóm tắt
- Lưu vào `recording` table (migration `0016_channel_recording.sql`): `room_id` nullable + thêm `study_group_channel_id` + CHECK XOR constraint
- Privacy: explicit consent prompt mọi participant trước khi start record

**Implementation V3:**
- Schema: `recording.room_id` nullable; thêm `study_group_channel_id` (FK CASCADE), `created_by`, CHECK `recording_owner_xor`, index `recording_channel_idx`
- API:
  - `POST /api/channels/[id]/record` — mod start composite egress (perm `voice.record` = MODERATOR+)
  - `GET /api/channels/[id]/record` — list recordings của channel
  - `POST /api/channels/[id]/record/[recordingId]/stop` — mod stop
- Webhook `egress_ended` route theo `studyGroupChannelId` → enqueue BullMQ job với `channelId`
- BullMQ `process-recording` mở rộng: nếu có `channelId` → bỏ flashcard auto-gen + INSERT system message của AI Tutor vào channel với link `/groups/recordings/{id}` + summary preview
- UI:
  - `VoiceRecordControl` button trong header (chỉ mod+ thấy)
  - `VoiceRecordingBanner` (banner đỏ blink cho mọi participant khi đang record)
  - `VoiceRecordingsList` (dưới pre-join screen, click vào → replay)
  - Page `/groups/recordings/[recId]` reuse `ReplayClient` (với `pusherChannelPrefix="presence-voice-"`)
- Realtime events qua `presence-voice-{channelId}`: `recording:started` / `recording:stopped` / `recording:ended` / `recording:processed`

#### 15.2.12. Workspaces (Phase 1)
**Use case:** Tự động sync workspace ↔ group (1 workspace = 1 study group cho team).
- Optional: khi tạo workspace với `type: 'team'` → auto-create matching study group với same members
- Sync: workspace.members ↔ group.members bidirectional
- KHÔNG bắt buộc V1 — pattern explicit user create separately

### 15.3. Cross-feature event bus

> Pattern: study group emit events qua BullMQ → các feature khác consume. Loose coupling — không direct dependency.

#### 15.3.1. Events study group EMIT

| Event | Payload | Subscribers (feature khác) |
|---|---|---|
| `group/created` | `{ groupId, ownerId, name }` | Analytics, Audit |
| `group/member-joined` | `{ groupId, userId, role }` | Analytics, Push (welcome), Mastery aggregator (add user vào cohort) |
| `group/member-left` | `{ groupId, userId }` | Analytics, Mastery aggregator (remove) |
| `group/channel-created` | `{ groupId, channelId, type }` | Audit, Search indexer (register channel) |
| `group/message-sent` | `{ messageId, channelId, authorId, mentions, conceptRefs, documentRefs }` | Notification (mention fanout), Search indexer, Concept linker, Mod scanner |
| `group/voice-session-ended` | `{ channelId, durationSec, participants[] }` | Analytics, Recording processor, Mastery (track study time) |
| `group/exam-shared` | `{ groupId, examId, sharedBy }` | Notification (broadcast tới members), Analytics |
| `group/deck-shared` | `{ groupId, deckId, sharedBy }` | Notification, Flashcard recommender |

#### 15.3.2. Events study group CONSUME

| Event source | Event | Reaction trong study group |
|---|---|---|
| `documents/uploaded` | New doc trong workspace | Suggest share vào group channel nếu doc relate môn nào (concept tag match channel topic) |
| `concept/mastery-changed` | User mastery thay đổi | Update group leaderboard cache + insights |
| `notification/preferences-changed` | User mute group | Disable push events cho user trong group đó |
| `user/deleted` | GDPR delete | Cascade anonymize (15.2.8) |
| `exam/attempt-submitted` | Student xong exam | Nếu exam được share trong group → post auto-message "{user} vừa hoàn thành {exam} điểm {X}" vào channel |
| `recording/transcribed` | LiveKit recording done | Post transcript + summary vào channel làm message system |

### 15.4. External integrations

#### 15.4.1. Email (V1.5)
- Daily digest 7am — recap activity của groups user joined hôm qua
- Mention email — nếu user không mở app trong 1h sau khi bị mention → send email với deep link
- Magic link join — invite qua email link thay vì code
- Stack: existing Resend/SendGrid pipeline (Phase M2)

#### 15.4.2. Slack bridge (V2)
- 1 group có thể bridge 1 Slack channel (2 chiều)
- Cogniva message → Slack post via webhook
- Slack message → Cogniva message via Slack Events API
- Permission: group OWNER add Slack workspace token
- Use case: 1 lớp dùng Slack chính, Cogniva mirror cho member chưa có Slack

#### 15.4.3. Discord bridge (V2)
- Tương tự Slack — qua Discord Bot API
- Use case: cộng đồng học sinh dùng Discord chính

#### 15.4.4. Calendar — Google Calendar / iCal (V2)
- Voice channel scheduled event → publish iCal feed
- User subscribe iCal URL → event hiện trên Google Calendar / Outlook
- Reverse: user share Google Calendar → Cogniva pull events vào group calendar

#### 15.4.5. LMS — Moodle / Canvas / Google Classroom (V3)
- LTI 1.3 standard — Cogniva làm LTI Tool
- Course trong Moodle → Cogniva auto-create matching study group
- Roster sync: enroll student trong Moodle → auto-join Cogniva group
- Grade passback: exam điểm push ngược lại Moodle gradebook

#### 15.4.6. SSO — SAML/OIDC (V3 enterprise)
- Trường đại học có Microsoft 365 / Google Workspace → SSO login
- Sync attributes: department → auto-assign group, role
- SCIM provisioning: HR system tạo user → auto-create Cogniva account

#### 15.4.7. Outbound webhooks (V2)
- Owner add webhook URL trong group settings
- Cogniva POST events tới URL (mention, member-joined, voice-started, ...)
- Use case: integrate Zapier, n8n, custom dashboard

```typescript
// Schema mới
study_group_webhook (
  id, group_id, url, secret (HMAC), events[] (filter), enabled,
  last_delivery_at, last_status, failure_count
)
```

Retry exponential backoff, disable sau 10 fail liên tiếp + email owner.

#### 15.4.8. Public API + OAuth apps (V3)
- Third-party dev đăng ký app → user authorize → app post messages on behalf
- Discord-style "bot" — accept OAuth scope `study_group.messages.write`, `study_group.read`
- Rate limit per app: 100 req/min, 10K/day

### 15.5. Integration testing strategy

V1 acceptance gồm cross-feature smoke test:

- [ ] User join group → mention trong message → mobile push fire (Phase M7 pipeline intact)
- [ ] User attach Cogniva document trong message → other member click → mở doc với permission check
- [ ] User mention `[[Đạo hàm]]` → pill render + click → mở concept page
- [ ] Owner share exam code → message hiển thị card → student click Start → exam flow normal
- [ ] User delete account → group message tự anonymize, voice_state purged, member row removed
- [ ] Mod kick member → audit_log có row với actor + reason
- [ ] Search "Đạo hàm" Ctrl+K → kết quả mix documents + messages + concepts + members

### 15.6. Migration order khi build

Khi start Phase 20:

1. **Batch A-G** (study group core) — không cần external integration
2. **Batch H** (integration layer):
   - Wire 15.2.6 notification (Phase M7 đã có)
   - Wire 15.2.7 audit log (existing)
   - Wire 15.2.8 GDPR cascade (existing pipeline extend)
3. **Batch I** (cross-feature):
   - 15.2.3 exam share
   - 15.2.4 concept mention
   - 15.2.2 flashcard share
4. **Batch J** (AI):
   - 15.2.5 @AI tutor in channel
5. **Batch K** (analytics):
   - 15.2.9 mastery aggregator
   - 15.2.10 unified search extension
6. **Batch L** (external V2+):
   - Email digest
   - Webhook out
   - Slack/Discord bridge
7. **Batch M** (enterprise V3):
   - LTI/LMS, SSO/SAML, public API

Khi triển khai theo thứ tự này: V1 release sau Batch H (~9 ngày), full Phase 20 sau Batch K (~14 ngày), V2 expand external integrations theo nhu cầu user thật.

---

**Status:** PLAN — chưa implement. Sau khi user approve Phase 19 polish done, start Batch A.
