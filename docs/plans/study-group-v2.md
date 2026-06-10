# Study Group V2 — Discord-parity upgrade

> **Mục tiêu:** Nâng cấp Cogniva Study Group từ V1 (foundation đã có) thành 1 nền tảng giao tiếp đầy đủ tính năng giống Discord — text/voice channel, threads, mentions, reactions, presence, permissions, push notifications — đồng thời tối ưu UI/UX chuyên nghiệp, polish toàn bộ tương tác.
>
> **Trạng thái V1 đã có:** schema 14 bảng (group/channel/member/message/voice-state/invite/read-state/category/stage-role/recording), 40+ API endpoint, LiveKit voice + Socket.IO self-host realtime (gateway `apps/realtime`) + R2 upload + multi-invite. UX còn raw, nhiều feature data-only chưa wire UI.
>
> **Tác giả:** chủ dự án — 2026-05-21.

---

## 📑 Mục lục

- [1. Vì sao V2](#1-vì-sao-v2)
- [2. So sánh với Discord — gaps](#2-so-sánh-với-discord--gaps)
- [3. Mục tiêu V2](#3-mục-tiêu-v2)
- [4. Roadmap 6 phase](#4-roadmap-6-phase)
- [5. Schema additions](#5-schema-additions)
- [6. API endpoints mới](#6-api-endpoints-mới)
- [7. UI/UX redesign chi tiết](#7-uiux-redesign-chi-tiết)
- [8. Notification integration](#8-notification-integration)
- [9. Real-time architecture](#9-real-time-architecture)
- [10. Effort estimate](#10-effort-estimate)
- [11. Non-goals](#11-non-goals)

---

## 1. Vì sao V2

V1 ship đủ schema + API cho MVP nhưng:

- **UX còn thô** — message item, channel list, member panel chưa polish; mobile UX rời rạc; thiếu animation transition; tab switching gây flash
- **Nhiều feature data-only** — `threadRootId`, `pinned`, `editedAt`, `reactions` đã có cột DB nhưng UI chưa wire
- **Permissions cứng** — chỉ 4 role hierarchical, không override được per-channel (vd chỉ MOD chat 1 channel, mọi người chỉ đọc)
- **Presence yếu** — polling 60s `lastSeenAt`, không real-time, không có status (online/idle/dnd/offline)
- **Notification chỉ in-app** — chưa fire push qua Expo; @mention không trigger notification log
- **Voice channel chưa có participant list real-time** — chỉ thấy avatar count, không thấy ai đang nói (speaking indicator)
- **Search ILIKE chậm** — chưa có FTS/Meilisearch index
- **Thiếu QoL** — typing indicator, message edit history, jump-to-message, unread divider, scroll-to-bottom button
- **Mobile** — chưa có 3-tab pattern như workspace (channel list / chat / member list)

V2 fix toàn bộ + thêm full Discord parity features.

---

## 2. So sánh với Discord — gaps

| # | Tính năng | Discord | Cogniva V1 | V2 plan |
|---|---|---|---|---|
| 1 | Server / channel tree | ✅ category + drag drop | ✅ schema có, UI partial | Polish drag-drop + collapse animation |
| 2 | Text channel chat | ✅ | ✅ basic | Polish UI: density modes, jump-to-message |
| 3 | Voice channel (audio) | ✅ | ✅ LiveKit | Thêm speaking indicator + push-to-talk |
| 4 | Voice channel (video) | ✅ | ✅ partial | Grid layout polish + spotlight speaker |
| 5 | Screen share | ✅ | ✅ data có | Stop share button + dedicated layout |
| 6 | Threads | ✅ | ⚠️ schema có, UI chưa | Build full thread sidebar + thread list |
| 7 | Forum channels | ✅ | ⚠️ schema có, UI chưa | Posts + tags + solution-mark |
| 8 | Stage channels | ✅ | ⚠️ schema có, UI chưa | Hand-raise + speaker promotion |
| 9 | Message reactions | ✅ emoji picker | ⚠️ data có | Build emoji picker + reaction bar |
| 10 | Replies / quotes | ✅ | ⚠️ data có | Reply preview chip + jump-to-original |
| 11 | @mentions | ⚠️ user/role/channel/everyone | ⚠️ data có | Autocomplete picker + notification fire |
| 12 | Per-channel permissions | ✅ override matrix | ❌ chỉ role hierarchy | Permission matrix table (V2) |
| 13 | Custom roles | ✅ unlimited custom | ❌ 4 fixed roles | Custom role với color + permissions |
| 14 | Pin message | ✅ | ⚠️ pinned col có | Pin menu + pinned messages panel |
| 15 | Edit / delete message | ⚠️ với history | ⚠️ API có | UI edit inline + "edited" badge + history |
| 16 | Search | ✅ FTS | ⚠️ ILIKE | Postgres FTS + GIN index + filter chip |
| 17 | Typing indicator | ✅ | ❌ | Socket.IO `typing` event với 5s timeout |
| 18 | Presence (status) | ✅ online/idle/dnd/offline | ⚠️ polling | Socket.IO presence channel + status picker |
| 19 | User status message | ✅ custom text + emoji | ❌ | Add user.statusText + user.statusEmoji |
| 20 | User profile card | ✅ hover popup | ❌ | Hover card với nickname/role/since |
| 21 | Notifications per channel | ✅ all/mentions/none | ⚠️ mute toggle | 3-state setting |
| 22 | Push notifications | ✅ | ❌ schema có chưa fire | Wire Inngest job push qua Expo + Web Push |
| 23 | Notification inbox | ✅ | ⚠️ API có UI chưa | NotificationBell + drawer panel |
| 24 | Audit log | ✅ | ✅ | OK — polish UI filter |
| 25 | Invite system | ✅ multi-use + expire | ✅ | OK |
| 26 | File / image upload | ✅ inline preview | ✅ | Polish lightbox + image carousel |
| 27 | Emoji picker | ✅ + custom server emoji | ❌ | Lib `emoji-mart` cho native; defer custom emoji |
| 28 | Slash commands | ✅ | ❌ | Defer V3 |
| 29 | Bots / webhooks | ✅ | ❌ | Defer V3 |
| 30 | Voice channel waveform | ✅ talking ring | ❌ | LiveKit `isSpeaking` → glow ring avatar |

**V2 scope: hàng 1-23 (essential Discord parity). Hàng 24-30 defer V3.**

---

## 3. Mục tiêu V2

### 3.1 Functional

1. **Threads** đầy đủ — reply trong message → tạo thread sidebar (Discord-style), thread list panel, archive sau 7 ngày
2. **Reactions + reply** UI hoàn chỉnh — emoji picker, reaction bar dưới message, click reaction toggle
3. **Mentions** + autocomplete `@` → fetch member list, fire notification log + push
4. **Voice channel UX** — speaking indicator (glowing ring), participant list realtime, push-to-talk, deafen, mute self/others (mod), screen share button, video grid
5. **Stage channels** — audience/speaker roles, hand-raise list, promote/demote
6. **Forum channels** — post create + tag picker + solution-mark + tag filter
7. **Per-channel permissions** — override matrix UI (allow/deny per permission per role per channel)
8. **Custom roles** — color, name, permission set, assign multi-role per member
9. **Presence realtime** — Socket.IO presence channel + status picker (online/idle/dnd/offline) + custom status text
10. **Typing indicator** — Socket.IO `typing` event (5s timeout)
11. **Notification fire** — @mention → notification log + push; channel mute override; in-app NotificationBell + drawer
12. **Search FTS** — Postgres tsvector GIN index thay ILIKE, filter chip (from:user, in:#channel, has:image, before:date)
13. **Pinned messages** — pin menu + sidebar panel "X messages pinned"
14. **Edit history** — store edit revisions, modal xem "Edited 3 times" expand
15. **Jump-to-message** — link copy + scroll into view + highlight
16. **Unread divider** — Discord-style "X new messages" line above first unread
17. **Mobile 3-tab** — channels / chat / members (giống workspace pattern V8.18)

### 3.2 UI/UX polish

- **Compact density** — Discord-like message grouping (consecutive msg cùng user trong 5min ẩn avatar/timestamp)
- **Hover toolbar** — hover message → emoji + reply + thread + edit + delete + more (positioned absolute, không reflow layout)
- **Optimistic UI** — send message hiện ngay với "sending..." indicator, replace khi server confirm
- **Animation** — channel switch fade-in (~150ms), modal scale+fade, drawer slide spring
- **Skeleton loaders** — channel list, message list, member list trong khi fetch
- **Empty states** — illustration + CTA cho mỗi panel rỗng
- **Accessibility** — keyboard navigation channel list (j/k), focus ring rõ, aria-live cho realtime updates
- **Dark/light parity** — verify mọi component đẹp ở cả 2 theme
- **Mobile-first** — touch target ≥ 44px, swipe-to-reply, long-press menu

---

## 4. Roadmap 6 phase

### Phase G1 — Permission & roles overhaul (~3 ngày)

- Schema: `study_group_role` (custom role), `study_group_channel_permission` (override matrix)
- API: CRUD role, assign multi-role member, channel permission editor
- UI: Settings > Roles tab (color picker + permission checkbox grid), Settings > Channel > Permissions sub-tab
- Migration: convert existing OWNER/ADMIN/MODERATOR/MEMBER → seed default roles, backward-compat layer

### Phase G2 — Message UX polish (~4 ngày)

- Build/wire: emoji picker (`emoji-mart`), reaction bar, reply chip, thread sidebar, pin panel
- Hover toolbar component (emoji + reply + thread + edit + delete + bookmark + more menu)
- Optimistic send + retry on fail
- Edit inline + "edited" badge + edit history modal
- Unread divider + jump-to-message + scroll-to-bottom FAB
- Message density modes (compact / cozy / comfortable)

### Phase G3 — Realtime presence + typing (~2 ngày)

- Wire Socket.IO presence channel cho mỗi group (subscribe member-list update)
- Status picker (online/idle/dnd/offline/invisible) + custom status modal
- `typing` event broadcast (debounce 1s) + render "X is typing..." footer
- Last-seen → realtime (no polling)
- AwayDetection: 15min no input → idle; visibility-change tab inactive → idle

### Phase G4 — Notifications integration (~3 ngày)

- Inngest function `push-notification` consume `notification/send` event → Expo Push API + Web Push
- Mention parser (server-side khi POST message) → tạo notification log + fire Inngest event
- Per-channel notification setting: all / mentions / none (mặc định mentions)
- @everyone / @here / role mention → gate theo permission
- NotificationBell topbar component + drawer panel (list + mark-read + jump-to-message link)
- Mobile push token register flow (Expo `getDevicePushTokenAsync` + POST `/api/push-token`)

### Phase G5 — Voice / Stage / Forum polish (~4 ngày)

- Voice channel UI: speaking indicator (LiveKit `isSpeaking`), participant grid với avatar+name, video tile khi cam on, control bar (mute/deafen/share/leave)
- Push-to-talk modes: Voice Activity (default) | Push-to-Talk (hold key) | Always-Open
- Stage channel: audience list, hand-raise queue, promote/demote button (MOD+)
- Forum channel: post create dialog, tag filter chip, solution-mark menu, sort (latest activity / newest / most reactions)

### Phase G6 — Search + threads full + mobile polish (~3 ngày)

- Postgres FTS: add `tsvector` cột generated cho `study_group_message.content`, GIN index, query qua `to_tsquery`
- Search UI: filter chip builder (from:@user in:#channel has:image before:date)
- Thread auto-archive job (Inngest cron daily) → archive thread idle > 7 ngày
- Thread list panel: active threads + archived (filter)
- Mobile 3-tab: channels / chat / members (responsive lg:hidden)
- Polish: skeleton loaders, empty states, transitions

---

## 5. Schema additions

### 5.1 Roles & permissions

```ts
// packages/db/src/schema.ts (additions)

export const studyGroupRole = pgTable(
  'study_group_role',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    groupId: text('group_id').notNull().references(() => studyGroup.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Hex color e.g. "#7289DA" — render avatar ring + name tint. */
    color: text('color').default('#9aa3af'),
    /** Vị trí trong hierarchy — cao hơn override thấp hơn. OWNER virtual = max. */
    position: integer('position').notNull().default(0),
    /** Permission bitfield — JSON map { canSendMessages: true, … } */
    permissions: jsonb('permissions').$type<RolePermissions>().notNull().default({}),
    /** Hoisted = show separately trong member list (Discord pattern). */
    hoisted: boolean('hoisted').default(false),
    /** Mentionable = @role có thể ping. */
    mentionable: boolean('mentionable').default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    groupPositionIdx: index('study_group_role_group_position_idx').on(t.groupId, t.position),
  }),
);

export const studyGroupMemberRole = pgTable(
  'study_group_member_role',
  {
    memberId: text('member_id').notNull().references(() => studyGroupMember.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull().references(() => studyGroupRole.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.memberId, t.roleId] }),
  }),
);

export const studyGroupChannelPermission = pgTable(
  'study_group_channel_permission',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    channelId: text('channel_id').notNull().references(() => studyGroupChannel.id, { onDelete: 'cascade' }),
    /** Target: role hoặc 1 user cụ thể. Exactly 1 phải set. */
    roleId: text('role_id').references(() => studyGroupRole.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** Override JSON: { canSendMessages: 'allow' | 'deny' | 'inherit', … } */
    overrides: jsonb('overrides').$type<PermissionOverrides>().notNull().default({}),
  },
  (t) => ({
    channelRoleUniq: uniqueIndex('study_group_chperm_role_uniq').on(t.channelId, t.roleId),
    channelUserUniq: uniqueIndex('study_group_chperm_user_uniq').on(t.channelId, t.userId),
  }),
);

type RolePermissions = {
  // General
  manageGroup?: boolean;
  manageRoles?: boolean;
  manageChannels?: boolean;
  viewAuditLog?: boolean;
  // Membership
  kickMembers?: boolean;
  banMembers?: boolean;
  inviteMembers?: boolean;
  changeNickname?: boolean;
  // Text channel
  viewChannel?: boolean;
  sendMessages?: boolean;
  sendMessagesInThreads?: boolean;
  embedLinks?: boolean;
  attachFiles?: boolean;
  addReactions?: boolean;
  useExternalEmoji?: boolean;
  mentionEveryone?: boolean;
  manageMessages?: boolean;
  manageThreads?: boolean;
  // Voice channel
  connect?: boolean;
  speak?: boolean;
  video?: boolean;
  screenShare?: boolean;
  muteMembers?: boolean;
  deafenMembers?: boolean;
  moveMembers?: boolean;
  // Stage channel
  requestToSpeak?: boolean;
  moderateStage?: boolean;
};

type PermissionOverrides = Partial<Record<keyof RolePermissions, 'allow' | 'deny' | 'inherit'>>;
```

### 5.2 Presence + typing

Presence chỉ cần Socket.IO (ephemeral, không persist). Status persistent thì add cột:

```ts
// Add to user table
status: text('status').$type<'online' | 'idle' | 'dnd' | 'offline' | 'invisible'>().default('online'),
statusText: text('status_text'),
statusEmoji: text('status_emoji'),
statusExpiresAt: timestamp('status_expires_at'),
```

### 5.3 Edit history

```ts
export const studyGroupMessageRevision = pgTable(
  'study_group_message_revision',
  {
    id: text('id').primaryKey().$defaultFn(createId),
    messageId: text('message_id').notNull().references(() => studyGroupMessage.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    editedAt: timestamp('edited_at').defaultNow().notNull(),
  },
  (t) => ({
    msgIdx: index('msg_revision_msg_idx').on(t.messageId, t.editedAt),
  }),
);
```

### 5.4 FTS index

```sql
-- Migration: add generated tsvector + GIN index
ALTER TABLE study_group_message
  ADD COLUMN search_vec tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content, ''))
  ) STORED;

CREATE INDEX study_group_message_search_idx
  ON study_group_message USING GIN (search_vec);
```

### 5.5 Per-channel notification setting

Đã có `studyGroupReadState.muted: boolean`. Mở rộng thành enum:

```ts
// Migrate study_group_read_state
ALTER TABLE study_group_read_state
  ADD COLUMN notification_setting text DEFAULT 'all'
  CHECK (notification_setting IN ('all', 'mentions', 'none'));

-- Backfill: muted=true → 'none', muted=false → 'all'
UPDATE study_group_read_state
  SET notification_setting = CASE WHEN muted THEN 'none' ELSE 'all' END;
```

---

## 6. API endpoints mới

### Roles & permissions

```
GET    /api/groups/[id]/roles                          — list roles + member count
POST   /api/groups/[id]/roles                          — create custom role (ADMIN+)
PUT    /api/groups/[id]/roles/[roleId]                 — update role (color, name, perms)
DELETE /api/groups/[id]/roles/[roleId]                 — delete role (cascade member_role)
POST   /api/groups/[id]/roles/reorder                  — bulk position update
PUT    /api/groups/[id]/members/[userId]/roles         — bulk set role[]

GET    /api/groups/[id]/channels/[cid]/permissions     — list override matrix
PUT    /api/groups/[id]/channels/[cid]/permissions     — upsert override (role hoặc user)
DELETE /api/groups/[id]/channels/[cid]/permissions/[overrideId]
```

### Threads (đầy đủ)

```
POST   /api/groups/[id]/channels/[cid]/messages/[msgId]/thread
       — tạo thread từ message; set thread_root_id, return new thread id
GET    /api/groups/[id]/channels/[cid]/threads
       — list active + archived threads
GET    /api/groups/[id]/threads/[tid]/messages         — pagination
POST   /api/groups/[id]/threads/[tid]/messages         — send vào thread
POST   /api/groups/[id]/threads/[tid]/archive          — manual archive
```

### Notifications

```
POST   /api/push-token                                  — register Expo / Web Push token
DELETE /api/push-token/[id]                            — unregister
PUT    /api/notifications/preferences                  — global setting (DnD hours, sound)
PUT    /api/groups/[id]/channels/[cid]/notifications   — per-channel setting (all/mentions/none)
```

### Presence + typing

Socket.IO events (không hit API):
- `presence-group-{id}` — member join/leave/update_status
- `private-channel-{cid}` — typing event `{ userId, expiresAt }`

### Mentions

POST message endpoint extend: parse `@<id>` từ content, tạo `notificationLog` rows, fire Inngest `notification/send` event với `pushToken[]`.

### Pins / edit history

```
POST   /api/groups/[id]/channels/[cid]/messages/[msgId]/pin
DELETE /api/groups/[id]/channels/[cid]/messages/[msgId]/pin
GET    /api/groups/[id]/channels/[cid]/pins
GET    /api/groups/[id]/channels/[cid]/messages/[msgId]/history  — list revisions
```

### Search (FTS)

```
GET /api/groups/[id]/search?q=X&from=userId&in=channelId&has=image&before=ISO
   — Postgres FTS với filter chip; rank by ts_rank
```

### Status

```
PUT /api/user/status   — { status, statusText?, statusEmoji?, expiresIn? }
```

---

## 7. UI/UX redesign chi tiết

### 7.1 Layout 3 cột (desktop)

```
┌─────────┬────────────────┬─────────┐
│ Channel │  Chat / Voice  │ Members │
│  list   │     content    │  panel  │
│  240px  │     flex-1     │  240px  │
└─────────┴────────────────┴─────────┘
```

- **Channel list (240px)**:
  - Header: group name + dropdown menu (settings, invite, leave)
  - Categories collapsible + drag-drop reorder (dnd-kit)
  - Channels: icon (# / 🔊 / 📣 / 📋) + name + unread dot + mute icon nếu muted
  - Active: bg-primary/10 + left accent bar
  - Hover: bg-muted/40 + show edit/delete icon (admin only)
  - Footer: user mini-bar (avatar + status + mute/deafen quick-toggle)

- **Chat area (flex-1)**:
  - Topbar: # channel-name + topic + member count + search button + pin button + thread button + member toggle (mobile)
  - Messages: virtualized list (react-virtual) cho 1000+ messages perf
  - Composer dưới: rich text + emoji + attach + send

- **Member panel (240px)**:
  - Sticky scroll, group theo role (hoisted roles separate header)
  - Member row: avatar + status dot + name + role color name + custom status text (truncate)
  - Right-click context menu: View profile, Send DM, Mention, Mute, Kick, Ban
  - Online count + total count footer

### 7.2 Message item (compact + cozy variants)

**Compact mode (Discord default):**
```
[avatar]  Username   Role     12:34   Message content here....
                              [hover toolbar →] 🙂 ↩️ 🧵 ✏️ 🗑️ ⋯
```
Consecutive messages cùng user trong 5 min → ẩn avatar + name, chỉ hiện indent + timestamp on hover.

**Cozy mode (default):**
```
[avatar]  Username   Role
          Message line 1
          Message line 2
          [hover toolbar absolute right]
          12:34
```

**Element details:**
- Reply chip: hiện ở trên message, click → jump-to-original
- Reaction bar: chip stack dưới content, click toggle, hover hiện list users
- Edit badge: "(đã sửa)" hiển thị inline timestamp; click → modal history
- Attachment: image grid + lightbox; file → pill download; embed link → og preview card
- Mention: `@username` rendered chip màu role (clickable → profile popup)

### 7.3 Composer

```
┌─────────────────────────────────────┐
│ [+] [🎨] @ # 🙂 [reply preview]     │
│ ─────────────────────────────────── │
│ Nhập tin nhắn vào #general...      │
│                              [Send] │
└─────────────────────────────────────┘
```

- `+` → file upload
- `🎨` → embed resource (doc/flashcard/exam picker — reuse existing rich-content)
- `@` → mention autocomplete (popover above)
- `#` → channel autocomplete
- `🙂` → emoji picker
- `Slash command` `/` (V3 defer)
- Reply preview: nếu user click reply → hiện chip trên composer "Reply to @user: …" với X cancel
- Shortcut: Enter send, Shift+Enter newline, Up edit last
- Slow mode countdown: "Bạn có thể gửi tiếp sau Xs"
- Char counter: hiện khi > 1500/2000

### 7.4 Voice channel UI

```
┌─────────────────────────────────────┐
│ 🔊 #general-voice    3 connected    │
├─────────────────────────────────────┤
│   [avatar]  [avatar]  [avatar]      │
│    Alice     Bob       Carol        │
│    🎤        🔇        🎥          │
├─────────────────────────────────────┤
│ [Mic] [Cam] [Screen] [Settings] [×] │
└─────────────────────────────────────┘
```

- Avatar grid: glowing ring khi `isSpeaking` (LiveKit hook)
- Status icons dưới avatar: mic muted, deafened, camera on, screen-sharing
- Video tile khi user enable cam — replace avatar
- Bottom control bar fixed: mic toggle, cam toggle, screen-share, settings (device picker), disconnect
- Push-to-talk indicator: hold spacebar → ring trắng around avatar
- Settings modal: input device, output device, noise suppression toggle, krisp-level toggle (LiveKit option)

### 7.5 Stage channel UI

```
┌──────────────────────────────────────┐
│ 📣 Discussion · 2 speakers · 12 lis  │
├──────────────────────────────────────┤
│ Speakers (2)                         │
│ ┌─────┐  ┌─────┐                    │
│ │Host │  │Alice│                    │
│ └─────┘  └─────┘                    │
├──────────────────────────────────────┤
│ Audience (12)                        │
│ [avatar avatar avatar avatar +8]     │
├──────────────────────────────────────┤
│ Hand raised (3) [MOD only sees this] │
│ Bob · Carol · Dan                    │
├──────────────────────────────────────┤
│ [✋ Raise hand] [Leave]              │
└──────────────────────────────────────┘
```

- Speaker promotion: MOD click ✋ → promote to speaker
- Hand-raise queue: FIFO ordered
- Audience listen only (mic disabled)

### 7.6 Forum channel UI

```
┌──────────────────────────────────────┐
│ 📋 Help · 24 posts                   │
│ [+ New post]  Filter: [All ▼] [tags] │
├──────────────────────────────────────┤
│ ┃ [solved] How to setup LiveKit?     │
│   by Alice · 2h ago · 5 replies     │
│   tags: [voice] [setup]              │
├──────────────────────────────────────┤
│   How to mention @everyone?         │
│   by Bob · 5h ago · 2 replies       │
│   tags: [mentions]                  │
└──────────────────────────────────────┘
```

- New post dialog: title + content + tag picker (multi-select)
- Click post → open in modal/route as thread channel
- Solution-mark: OP / MOD click 1 reply → mark as solved → post header chip
- Tag filter: AND/OR chip combiner

### 7.7 Settings page (group)

Tab list:
1. **Overview** — name, description, icon, banner, language, region
2. **Roles** — list custom roles + create/edit/delete + drag-drop reorder + color picker + permission grid
3. **Channels** — channel list drag-drop + create + edit topic/slow-mode + delete
4. **Members** — list + role assign + nickname + kick/ban
5. **Invites** — list active codes + create + revoke
6. **Notifications** — global DnD hours + sound toggle (per-channel ở channel header)
7. **Audit log** — filter by user + action + date range
8. **Integrations** — webhooks, bots (defer V3)

### 7.8 Notification UI

**NotificationBell topbar** (mọi route):
- Bell icon + red dot khi unreadCount > 0
- Click → Sheet (right drawer) hiện list:
  - Group by group → channel
  - Mention: highlighted yellow
  - Reply: blue
  - System: gray
- Per-item: avatar + sender + preview + relative time + jump button
- Footer: "Mark all read" + "Settings"

**Push notification mobile (Expo)**:
- Title: `<sender> in #<channel>`
- Body: message preview (truncate 100 chars)
- Data: `{ groupId, channelId, messageId }` → deep link
- Sound: default Cogniva chime
- Badge count: total unread

### 7.9 Mobile

3-tab pattern giống workspace V8.18:
```
[Kênh] [Trò chuyện] [Thành viên]
─────────────────────────────────
        ┌────────────┐
        │   content  │
        │            │
        └────────────┘
```

- Swipe left/right giữa tabs (`react-swipeable` hoặc native scroll snap)
- Long-press message → bottom sheet actions
- Swipe message right → reply
- Pull-to-refresh message list
- Voice channel: full-screen control với swipe-down minimize

### 7.10 Animations + transitions

- Channel switch: cross-fade content 150ms
- Modal: scale-95→scale-100 + fade 200ms (đã có Radix default)
- Drawer: slide spring (300ms tension 250)
- Message append: slide-from-bottom 80ms
- Reaction toggle: scale punch (1 → 1.3 → 1) 250ms
- Typing dots: 3 dots wave loop
- Voice speaking ring: pulse green 2s loop

---

## 8. Notification integration

### 8.1 Trigger sources

| Event | Trigger | Audience |
|---|---|---|
| @mention user | POST message parse `@<userId>` | mentioned users only |
| @role mention | POST message parse `@<roleId>` | all users in role |
| @here | POST message parse `@here` | online users in channel |
| @everyone | POST message parse `@everyone` | all members (cần permission) |
| DM message | POST DM | recipient |
| Reply to your message | POST message with replyToId | original author |
| Reaction on your message | POST react | original author |
| Group invite accepted | POST join | inviter (optional) |
| Voice channel invite | future feature | invited user |
| Stage hand-raise | POST raise | stage moderators |
| Recording ready | LiveKit egress webhook | room owner |
| Streak warning | cron daily | user |

### 8.2 Flow

```
1. API POST /messages parse mentions → tạo notification log rows
2. fire Inngest event 'notification/send' với { userId, type, channelId, … }
3. Inngest function 'send-notification':
   a. Check per-channel preference (all/mentions/none + DnD hours)
   b. Check user.status (skip nếu invisible/dnd cho non-mentions)
   c. Query pushToken[] active
   d. Fan-out:
      - Expo Push API (mobile)
      - Web Push (browser, Phase 11+ với SW)
      - Socket.IO event 'notification:new' (in-app realtime bell)
   e. Update notification_log.status = 'sent' | 'failed'
4. Client subscribe Socket.IO 'notification:new' → update bell badge ngay
```

### 8.3 Mute logic

```ts
// pseudo
function shouldNotify(user, channel, message, mentioned) {
  const setting = readState.notification_setting; // 'all' | 'mentions' | 'none'
  if (setting === 'none') return false;
  if (setting === 'mentions' && !mentioned) return false;
  if (user.status === 'dnd') return mentioned; // DnD vẫn nhận mention
  if (isInDndHours(user.dndStart, user.dndEnd)) return mentioned;
  return true;
}
```

### 8.4 Push payload schema

```json
{
  "to": "ExponentPushToken[...]",
  "sound": "cogniva-chime",
  "title": "Alice in #general",
  "body": "Hey @you, check this out",
  "data": {
    "type": "mention",
    "groupId": "g_xxx",
    "channelId": "c_xxx",
    "messageId": "m_xxx",
    "deepLink": "/groups/g_xxx/c_xxx?msg=m_xxx"
  },
  "badge": 5,
  "channelId": "messages",
  "priority": "high"
}
```

### 8.5 Web Push (Phase 11+ deferred wire)

Use `web-push` lib + VAPID keys. Service Worker `sw.js` listen `push` event → `showNotification`.

---

## 9. Real-time architecture

### 9.1 Socket.IO channels

| Channel | Type | Subscribers | Events |
|---|---|---|---|
| `private-channel-{cid}` | private | members of channel | message:new, message:edit, message:delete, reaction:toggle, typing |
| `presence-group-{gid}` | presence | members of group | (auto join/leave + custom status updates) |
| `private-voice-{cid}` | private | participants of voice channel | speaking:start, speaking:end |
| `private-user-{uid}` | private | self only | notification:new, dm:message |
| `private-thread-{tid}` | private | thread participants | thread:message |

### 9.2 Socket.IO auth flow

POST `/api/realtime/auth` (đã có) — verify session → authorize channel access (membership) → trả `{ user }` (cookie web / bearer mobile). Không còn ký token kiểu Pusher.

V2 extends:
- Presence channels: trả `user_info` JSON gồm `{ id, name, image, status }`
- Private channels: check `studyGroupMember.role + permissions matrix` (V2 mới)

### 9.3 LiveKit integration

V1 đã có. V2 polish:
- Subscribe `participant.isSpeaking` → broadcast Socket.IO `speaking:start/end` cho avatar ring
- Server-side mute (LiveKit Server SDK `updateParticipant`) → kick mic
- Egress recording trigger từ MOD button

---

## 10. Effort estimate

| Phase | Mô tả | Effort |
|---|---|---|
| G1 | Permission & roles | 3 ngày |
| G2 | Message UX polish | 4 ngày |
| G3 | Presence + typing | 2 ngày |
| G4 | Notifications integration | 3 ngày |
| G5 | Voice / Stage / Forum polish | 4 ngày |
| G6 | Search + threads full + mobile | 3 ngày |
| | **Tổng** | **~19 ngày** |

→ 1 dev full-time ~4 tuần.

**Quick wins (1 ngày each, có thể ship trước roadmap):**
- NotificationBell topbar wire vào API hiện có
- Mention parser server-side fire notification log
- Typing indicator (Socket.IO event, không cần schema)
- Pinned messages UI (cột pinned đã có)
- Unread divider (read state đã có)

→ Có thể ship 5 quick wins trong tuần đầu trước khi vào G1.

---

## 11. Non-goals

V2 **KHÔNG bao gồm**:

- **Bots / webhooks API** → defer V3 (cần API key system + rate limiter riêng)
- **Slash commands** → defer V3
- **Custom server emoji** → defer V3 (cần emoji storage + reactions xài custom)
- **Voice channel recording** → đã có schema (recording dual owner) nhưng UI vẫn V1 — defer polish V3
- **Multi-server (NestedNation pattern)** → Cogniva 1 user = nhiều study group đã đủ
- **End-to-end encryption** → Discord cũng chưa có; defer pivot lớn V4
- **Video conferencing >25 people** → LiveKit miễn phí giới hạn — defer enterprise tier
- **Server boost / nitro** → không phù hợp learning platform monetization

---

## 12. Definition of done

V2 coi như xong khi:

1. ✅ User tạo custom role với màu + permissions, gán cho member
2. ✅ Per-channel permission override hoạt động (e.g. role X chỉ đọc trong #announcements)
3. ✅ Click message → tạo thread, thread sidebar mở, gửi reply vào thread
4. ✅ @mention user → autocomplete popover, post → mentioned user nhận push notification
5. ✅ Voice channel: thấy speaking indicator (glow ring) khi user nói
6. ✅ Stage channel: audience raise hand, MOD promote thành speaker
7. ✅ Forum channel: tạo post với tag, filter theo tag, mark solution
8. ✅ NotificationBell topbar hiện unreadCount + drawer list + jump-to-message
9. ✅ Typing indicator hiện "X đang gõ…" footer dưới chat
10. ✅ Search FTS trả kết quả < 200ms với 10k messages
11. ✅ Mobile: 3-tab swipe-able, long-press message bottom sheet
12. ✅ Status picker: online/idle/dnd + custom status text
13. ✅ Pin message + pinned panel
14. ✅ Edit message inline + edit history modal
15. ✅ Push notification mobile (Expo) + Web Push (Phase 11+ optional)
16. ✅ Typecheck pass + smoke test 6 phase

---

## 13. Quick reference — files sẽ thay đổi / tạo mới

### Tạo mới (~25 files)

```
packages/db/src/schema.ts                              — thêm 4 bảng + 3 cột
packages/db/migrations/0030_group_v2_perms.sql
packages/db/migrations/0031_group_v2_fts.sql
packages/db/migrations/0032_group_v2_revisions.sql

apps/web/src/lib/group/permissions.ts                 — compute effective permission
apps/web/src/lib/group/mentions.ts                    — parser server-side
apps/web/src/lib/group/notification-fire.ts           — fire Inngest event helper
apps/web/src/lib/notifications/push.ts                — Expo + Web Push wrapper
apps/web/src/inngest/functions/send-notification.ts   — Inngest worker

apps/web/src/app/api/groups/[id]/roles/route.ts
apps/web/src/app/api/groups/[id]/roles/[roleId]/route.ts
apps/web/src/app/api/groups/[id]/channels/[cid]/permissions/route.ts
apps/web/src/app/api/groups/[id]/channels/[cid]/messages/[msgId]/thread/route.ts
apps/web/src/app/api/groups/[id]/threads/[tid]/messages/route.ts
apps/web/src/app/api/groups/[id]/channels/[cid]/messages/[msgId]/pin/route.ts
apps/web/src/app/api/groups/[id]/channels/[cid]/messages/[msgId]/history/route.ts
apps/web/src/app/api/push-token/route.ts
apps/web/src/app/api/user/status/route.ts

apps/web/src/components/groups/v2/role-editor.tsx
apps/web/src/components/groups/v2/permission-matrix.tsx
apps/web/src/components/groups/v2/thread-sidebar.tsx
apps/web/src/components/groups/v2/emoji-picker.tsx
apps/web/src/components/groups/v2/mention-autocomplete.tsx
apps/web/src/components/groups/v2/typing-indicator.tsx
apps/web/src/components/groups/v2/voice-control-bar.tsx
apps/web/src/components/groups/v2/voice-participant-tile.tsx
apps/web/src/components/groups/v2/stage-hand-raise.tsx
apps/web/src/components/groups/v2/forum-post-card.tsx
apps/web/src/components/notifications/notification-bell.tsx
apps/web/src/components/notifications/notification-drawer.tsx
apps/web/src/components/groups/v2/status-picker.tsx
apps/web/src/components/groups/v2/pin-panel.tsx
```

### Sửa (~15 files)

```
apps/web/src/app/(app)/groups/[id]/[channelId]/page.tsx — 3-col layout polish
apps/web/src/app/(app)/groups/[id]/settings/* — thêm tab Roles
apps/web/src/components/groups/message-item.tsx — reactions + reply + hover toolbar
apps/web/src/components/groups/message-list.tsx — virtualization + unread divider
apps/web/src/components/groups/message-composer.tsx — mention + emoji + reply preview
apps/web/src/components/groups/voice-channel.tsx — speaking indicator
apps/web/src/components/groups/channel-list-item.tsx — notification bell per channel
apps/web/src/components/groups/member-list.tsx — group by hoisted role + status dot
apps/web/src/app/api/groups/[id]/channels/[cid]/messages/route.ts — mention fire
apps/web/src/lib/realtime-server.ts — typing event broadcast
apps/web/src/lib/realtime-client.ts — subscribe presence + typing
apps/web/src/app/api/realtime/auth/route.ts — presence channel auth
apps/web/src/app/api/groups/[id]/channels/[cid]/messages/[msgId]/route.ts — edit history persist
apps/web/src/app/(app)/layout.tsx — mount NotificationBell topbar
apps/web/src/lib/i18n/dict.ts — add ~80 strings cho groups v2
```

---

*Plan v1.0 — viết 2026-05-21 sau khi survey hệ thống V1. Update khi build từng phase.*
