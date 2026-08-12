// chat.js – Orbit using Matrix REST API, no SDK

// ---------- Session & theme helpers ----------
const SESSION_KEY = 'orbit.session';
const THEME_KEY = 'orbit-theme';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.homeserver || !s.userId || !s.accessToken) return null;
    return s;
  } catch { return null; }
}
function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'system';
}
applyTheme(getInitialTheme());

// ---------- Session check ----------
const session = loadSession();
if (!session) {
  window.location.href = './index.html';
}

// ---------- Matrix REST client ----------
const baseUrl = session.homeserver;
const accessToken = session.accessToken;
const userId = session.userId;
let nextBatch = null;
let syncing = true;

// Core request function
async function matrixRequest(endpoint, options = {}) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || data.errcode || `Matrix request failed (${response.status})`);
    err.errcode = data.errcode;
    err.status = response.status;
    throw err;
  }
  return data;
}

// ---------- Room state (cached locally) ----------
let rooms = new Map(); // roomId -> room object

function createRoomObject(roomId) {
  return {
    roomId,
    name: null,
    topic: null,
    avatarUrl: null,
    encrypted: false,
    members: new Map(), // userId -> { displayName, avatarUrl, membership }
    timeline: [],       // array of event objects
    unread: 0,
    notificationCount: 0,
    highlightCount: 0,
    typing: [],         // user IDs currently typing
    membership: 'join',
    lastEvent: null,
  };
}

// ---------- Sync ----------
async function sync(since = '') {
  const params = new URLSearchParams({
    timeout: '30000',
    filter: JSON.stringify({
      room: { timeline: { limit: 30 }, state: { lazy_load_members: true } }
    })
  });
  if (since) params.set('since', since);
  return matrixRequest(`/_matrix/client/v3/sync?${params}`);
}

function processSync(data) {
  // Process joined rooms
  const join = data.rooms?.join || {};
  for (const [roomId, roomData] of Object.entries(join)) {
    let room = rooms.get(roomId);
    if (!room) {
      room = createRoomObject(roomId);
      rooms.set(roomId, room);
    }
    applyRoomData(room, roomData);
  }

  // Process left rooms
  const leave = data.rooms?.leave || {};
  for (const roomId of Object.keys(leave)) {
    rooms.delete(roomId);
  }

  // Process invites (optional, we'll ignore for now)
}

function applyRoomData(room, roomData) {
  // State events (name, topic, avatar, encryption, members)
  const stateEvents = [
    ...(roomData.state?.events || []),
    ...(roomData.timeline?.events || []).filter(e => e.state_key !== undefined)
  ];
  for (const ev of stateEvents) {
    if (ev.type === 'm.room.name') room.name = ev.content?.name || null;
    if (ev.type === 'm.room.topic') room.topic = ev.content?.topic || null;
    if (ev.type === 'm.room.avatar') room.avatarUrl = ev.content?.url || null;
    if (ev.type === 'm.room.encryption') room.encrypted = true;
    if (ev.type === 'm.room.member' && ev.state_key) {
      const uid = ev.state_key;
      room.members.set(uid, {
        userId: uid,
        displayName: ev.content?.displayname || null,
        avatarUrl: ev.content?.avatar_url || null,
        membership: ev.content?.membership,
      });
    }
  }

  // Timeline events (messages, etc.)
  const timeline = roomData.timeline?.events || [];
  for (const ev of timeline) {
    if (ev.type === 'm.room.message' || ev.type === 'm.room.encrypted' || ev.type === 'm.room.redaction') {
      room.timeline.push(ev);
      if (room.timeline.length > 200) room.timeline.shift();
      room.lastEvent = ev;
    }
  }

  // Unread counts
  if (roomData.unread_notifications) {
    room.notificationCount = roomData.unread_notifications.notification_count || 0;
    room.highlightCount = roomData.unread_notifications.highlight_count || 0;
    room.unread = room.notificationCount;
  }

  // Typing
  if (roomData.ephemeral?.events) {
    for (const ev of roomData.ephemeral.events) {
      if (ev.type === 'm.typing') {
        const typingUsers = (ev.content?.user_ids || []).filter(id => id !== userId);
        room.typing = typingUsers;
      }
    }
  }
}

// ---------- Sync loop ----------
async function startSync() {
  while (syncing) {
    try {
      const data = await sync(nextBatch || '');
      nextBatch = data.next_batch;
      processSync(data);
      // Update UI after each sync
      renderRoomList();
      if (activeRoomId) {
        const room = rooms.get(activeRoomId);
        if (room) {
          renderMessages(room);
          updateChatHeader(room);
          updateComposerVisibility(room);
          // send read receipt for latest if any
          const last = room.timeline[room.timeline.length - 1];
          if (last) sendReadReceipt(activeRoomId, last.event_id);
        } else {
          // room left
          activeRoomId = null;
          chatView.classList.add('hidden');
          emptyState.classList.remove('hidden');
          document.querySelector('#main-view').classList.remove('chat-open');
        }
      }
    } catch (error) {
      console.error('Sync error:', error);
      if (error.errcode === 'M_UNKNOWN_TOKEN') {
        clearSession();
        window.location.href = './index.html';
        break;
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ---------- DOM refs ----------
const $ = id => document.getElementById(id);
const roomList = $('room-list');
const messageList = $('message-list');
const emptyState = $('empty-state');
const chatView = $('chat-view');
const chatName = $('chat-name');
const chatStatus = $('chat-status');
const chatAvatar = $('chat-avatar');
const composer = $('composer');
const messageInput = $('message-input');
const typingIndicator = $('typing-indicator');
const searchInput = $('room-search');
const themeToggle = $('theme-toggle');
const newDmBtn = $('new-dm-btn');
const dmModal = $('dm-modal');
const dmUserInput = $('dm-user');
const dmResults = $('dm-results');
const dmError = $('dm-error');
const startDmBtn = $('start-dm');
const cancelDmBtn = $('cancel-dm');
const closeDmBtn = $('close-dm');
const backBtn = $('back-btn');
const profileBtn = $('profile-btn');
const chatMenuBtn = $('chat-menu');

// ---------- State ----------
let activeRoomId = null;
let searchQuery = '';
let typingTimer = null;
let dmSearchTimer = null;

// ---------- UI helpers ----------
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function linkify(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function roomDisplayName(room) {
  if (room.name) return room.name;
  const others = Array.from(room.members.values()).filter(m => m.userId !== userId && m.membership === 'join');
  if (others.length === 1) return others[0].displayName || others[0].userId;
  if (others.length > 1) {
    return others.slice(0, 3).map(m => m.displayName || m.userId.split(':')[0].slice(1)).join(', ');
  }
  return room.roomId;
}

function getMemberDisplayName(room, uid) {
  const m = room.members.get(uid);
  return m ? m.displayName || uid : uid;
}

// ---------- Room list ----------
function renderRoomList() {
  const q = searchQuery.toLowerCase().trim();
  const filtered = q
    ? Array.from(rooms.values()).filter(r => roomDisplayName(r).toLowerCase().includes(q))
    : Array.from(rooms.values());

  filtered.sort((a, b) => {
    const ta = a.lastEvent?.origin_server_ts || 0;
    const tb = b.lastEvent?.origin_server_ts || 0;
    return tb - ta;
  });

  roomList.innerHTML = '';
  if (!filtered.length) {
    roomList.innerHTML = '<li class="room-item" style="color:var(--text-3);cursor:default">No rooms</li>';
    return;
  }

  for (const room of filtered) {
    const li = document.createElement('li');
    li.className = 'room-item' + (room.roomId === activeRoomId ? ' active' : '');
    li.dataset.roomId = room.roomId;

    const name = roomDisplayName(room);
    const avatarSrc = room.avatarUrl ? mxcToHttp(room.avatarUrl) : '';
    const preview = room.lastEvent
      ? (room.lastEvent.content?.body || (room.lastEvent.type === 'm.room.encrypted' ? 'Encrypted message' : ''))
      : '';
    const time = room.lastEvent ? formatTime(room.lastEvent.origin_server_ts) : '';
    const lock = room.encrypted ? '<span class="lock">🔒</span>' : '';
    const badge = room.unread > 0 ? `<span class="badge">${room.unread > 99 ? '99+' : room.unread}</span>` : '';

    li.innerHTML = `
      <img class="avatar" src="${escapeHtml(avatarSrc)}" alt="" onerror="this.style.display='none'" />
      <div class="room-info">
        <div class="name">${escapeHtml(name)} ${lock}</div>
        <div class="preview">${escapeHtml(preview.slice(0, 80))}</div>
      </div>
      <div class="room-meta-right">
        <div class="time">${escapeHtml(time)}</div>
        ${badge}
      </div>
    `;
    li.addEventListener('click', () => selectRoom(room.roomId));
    roomList.appendChild(li);
  }
}

// ---------- MXC to HTTP ----------
function mxcToHttp(mxc, width = 44, height = 44) {
  if (!mxc || !mxc.startsWith('mxc://')) return '';
  const parts = mxc.slice(6).split('/');
  if (parts.length < 2) return '';
  const server = parts[0];
  const mediaId = parts.slice(1).join('/');
  return `${baseUrl}/_matrix/media/v3/thumbnail/${server}/${mediaId}?width=${width}&height=${height}&method=crop`;
}

// ---------- Select room ----------
function selectRoom(roomId) {
  activeRoomId = roomId;
  const room = rooms.get(roomId);
  if (!room) return;

  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');
  document.querySelector('#main-view').classList.add('chat-open');

  updateChatHeader(room);
  renderMessages(room);
  updateComposerVisibility(room);
  renderRoomList();

  // Send read receipt for latest
  if (room.timeline.length) {
    const last = room.timeline[room.timeline.length - 1];
    sendReadReceipt(roomId, last.event_id);
  }
}

// ---------- Update header ----------
function updateChatHeader(room) {
  chatName.textContent = roomDisplayName(room);
  chatStatus.textContent = room.topic || '';
  const avatarSrc = room.avatarUrl ? mxcToHttp(room.avatarUrl) : '';
  chatAvatar.src = avatarSrc;
  chatAvatar.onerror = () => { chatAvatar.style.display = 'none'; };
}

// ---------- Render messages ----------
function renderMessages(room) {
  const events = room.timeline.filter(e =>
    e.type === 'm.room.message' || e.type === 'm.room.encrypted' || e.type === 'm.room.redaction'
  );

  let html = '';
  let lastSender = null;
  for (const ev of events) {
    if (ev.type === 'm.room.redaction') continue;
    const redacted = ev.unsigned?.redacted_because;
    const isMine = ev.sender === userId;
    const senderName = isMine
      ? 'You'
      : getMemberDisplayName(room, ev.sender);
    const showSender = !isMine && lastSender !== ev.sender;
    lastSender = ev.sender;

    let body = '';
    if (redacted) {
      body = '<em>Message deleted</em>';
    } else if (ev.type === 'm.room.encrypted') {
      body = '<em>🔒 Encrypted message</em><div class="enc-badge">Cannot decrypt in this build</div>';
    } else {
      body = linkify(ev.content?.body || '');
      if (ev.content?.['m.relates_to']?.['m.in_reply_to']) {
        body = `<div class="reply-preview">Reply</div>${body}`;
      }
    }

    html += `
      <div class="msg ${isMine ? 'mine' : 'theirs'}${redacted ? ' redacted' : ''}" data-event-id="${escapeHtml(ev.event_id)}">
        ${showSender ? `<div class="sender">${escapeHtml(senderName)}</div>` : ''}
        <div class="body">${body}</div>
        <div class="time">${formatTime(ev.origin_server_ts)}</div>
      </div>
    `;
  }
  messageList.innerHTML = html;
  messageList.scrollTop = messageList.scrollHeight;
}

// ---------- Composer visibility ----------
function updateComposerVisibility(room) {
  if (!room) return;
  // Check if user is joined and can send
  const member = room.members.get(userId);
  const canSend = member && member.membership === 'join' && !room.encrypted; // we can't send encrypted yet
  composer.classList.toggle('hidden', !canSend);
}

// ---------- Typing indicator ----------
function updateTyping(room) {
  if (!room.typing || !room.typing.length) {
    typingIndicator.classList.add('hidden');
    return;
  }
  const names = room.typing.map(id => getMemberDisplayName(room, id));
  const text = names.length === 1
    ? `${names[0]} is typing…`
    : `${names.slice(0, 2).join(', ')} are typing…`;
  typingIndicator.textContent = text;
  typingIndicator.classList.remove('hidden');
}

// ---------- Send message ----------
async function sendMessage(text) {
  if (!text || !activeRoomId) return;
  const txnId = `m${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  try {
    await matrixRequest(
      `/_matrix/client/v3/rooms/${encodeURIComponent(activeRoomId)}/send/m.room.message/${txnId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ msgtype: 'm.text', body: text }),
      }
    );
    // Clear typing
    sendTyping(activeRoomId, false);
  } catch (err) {
    console.error('Send failed:', err);
    // Optionally show error
  }
}

// ---------- Send typing ----------
async function sendTyping(roomId, typing = true) {
  try {
    await matrixRequest(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(userId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ typing, timeout: 10000 }),
      }
    );
  } catch {}
}

// ---------- Read receipt ----------
async function sendReadReceipt(roomId, eventId) {
  try {
    await matrixRequest(
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/m.read/${encodeURIComponent(eventId)}`,
      { method: 'POST' }
    );
  } catch {}
}

// ---------- Create DM ----------
async function createDM(targetUserId) {
  // Check existing DM
  for (const room of rooms.values()) {
    const members = Array.from(room.members.values()).filter(m => m.membership === 'join');
    if (members.length === 2 && members.some(m => m.userId === targetUserId) && members.some(m => m.userId === userId)) {
      return room.roomId;
    }
  }
  // Create new room
  const body = {
    preset: 'trusted_private_chat',
    visibility: 'private',
    invite: [targetUserId],
    is_direct: true,
    initial_state: [
      {
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      }
    ],
  };
  const data = await matrixRequest('/_matrix/client/v3/createRoom', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return data.room_id;
}

// ---------- User search ----------
async function searchUsers(term, limit = 8) {
  try {
    const data = await matrixRequest('/_matrix/client/v3/user_directory/search', {
      method: 'POST',
      body: JSON.stringify({ search_term: term, limit }),
    });
    return data.results || [];
  } catch {
    return [];
  }
}

// ---------- Theme toggle ----------
themeToggle?.addEventListener('click', () => {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});

// ---------- UI event bindings ----------
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderRoomList();
});

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = '';
  sendMessage(text);
});

messageInput.addEventListener('input', () => {
  if (!activeRoomId) return;
  sendTyping(activeRoomId, true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => sendTyping(activeRoomId, false), 5000);
});

backBtn.addEventListener('click', () => {
  activeRoomId = null;
  chatView.classList.add('hidden');
  emptyState.classList.remove('hidden');
  document.querySelector('#main-view').classList.remove('chat-open');
  renderRoomList();
});

// DM modal controls
newDmBtn.addEventListener('click', () => {
  dmModal.classList.remove('hidden');
  dmUserInput.value = '';
  dmResults.innerHTML = '';
  dmError.classList.add('hidden');
  dmUserInput.focus();
});

function closeDmModal() {
  dmModal.classList.add('hidden');
}
cancelDmBtn.addEventListener('click', closeDmModal);
closeDmBtn.addEventListener('click', closeDmModal);
dmModal.addEventListener('click', (e) => {
  if (e.target === dmModal) closeDmModal();
});

// DM search
dmUserInput.addEventListener('input', debounce(async () => {
  const term = dmUserInput.value.trim();
  if (!term || term.length < 2) {
    dmResults.innerHTML = '';
    return;
  }
  if (term.startsWith('@') && term.includes(':')) {
    dmResults.innerHTML = '<p style="font-size:.8rem;color:var(--text-3)">Press Start to chat.</p>';
    return;
  }
  const results = await searchUsers(term);
  dmResults.innerHTML = results.map(u => `
    <div class="dm-result" data-uid="${escapeHtml(u.user_id)}">
      <div>
        <div class="truncate">${escapeHtml(u.display_name || u.user_id)}</div>
        <div class="dm-id truncate">${escapeHtml(u.user_id)}</div>
      </div>
    </div>
  `).join('') || '<p style="font-size:.8rem;color:var(--text-3)">No results</p>';
  dmResults.querySelectorAll('.dm-result').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.dataset.uid;
      startDirectMessage(uid);
    });
  });
}, 300));

async function startDirectMessage(uid) {
  if (!/^@[A-Za-z0-9._=\-/]+:[^\s]+$/.test(uid)) {
    dmError.textContent = 'Enter a valid Matrix ID, e.g. @alice:matrix.org';
    dmError.classList.remove('hidden');
    return;
  }
  try {
    const roomId = await createDM(uid);
    closeDmModal();
    selectRoom(roomId);
  } catch (err) {
    dmError.textContent = err.message || 'Failed to start conversation.';
    dmError.classList.remove('hidden');
  }
}
startDmBtn.addEventListener('click', () => {
  const uid = dmUserInput.value.trim();
  if (uid) startDirectMessage(uid);
});

// Profile button – set display name
profileBtn.addEventListener('click', () => {
  const currentName = session.displayName || '';
  const newName = prompt('Set display name:', currentName);
  if (newName !== null && newName !== currentName) {
    matrixRequest(`/_matrix/client/v3/profile/${encodeURIComponent(userId)}/displayname`, {
      method: 'PUT',
      body: JSON.stringify({ displayname: newName }),
    }).then(() => {
      session.displayName = newName;
      saveSession(session);
    }).catch(err => alert(err.message));
  }
});

// Chat menu – room info & leave
chatMenuBtn.addEventListener('click', () => {
  if (!activeRoomId) return;
  const room = rooms.get(activeRoomId);
  if (!room) return;
  const members = Array.from(room.members.values()).filter(m => m.membership === 'join');
  const memberList = members.map(m => `<div class="member">${escapeHtml(m.displayName || m.userId)}</div>`).join('');
  const encrypted = room.encrypted ? '🔒 Encrypted' : 'Not encrypted';
  if (confirm(`Room: ${roomDisplayName(room)}\nMembers: ${members.length}\n${encrypted}\n\nLeave room?`)) {
    matrixRequest(`/_matrix/client/v3/rooms/${encodeURIComponent(activeRoomId)}/leave`, {
      method: 'POST'
    }).then(() => {
      activeRoomId = null;
      chatView.classList.add('hidden');
      emptyState.classList.remove('hidden');
      document.querySelector('#main-view').classList.remove('chat-open');
      renderRoomList();
    }).catch(err => alert(err.message));
  }
});

// ---------- Start sync ----------
startSync();

// ---------- Debounce helper ----------
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}