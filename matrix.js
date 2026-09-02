import {
  createClient,
  ClientEvent,
  RoomEvent,
  MatrixEvent,
  EventType
} from 'matrix-js-sdk';

const SESSION_KEY = 'orbit.session';

let client = null;
let started = false;
let syncPromise = null;

const listeners = new Map();

function loadSession() {
  try {
    return JSON.parse(
      localStorage.getItem(SESSION_KEY) || 'null'
    );
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(session)
  );
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function emit(name, ...args) {
  const handlers = listeners.get(name);

  if (!handlers) {
    return;
  }

  for (const handler of handlers) {
    try {
      handler(...args);
    } catch (error) {
      console.error(`[Orbit] ${name} listener failed`, error);
    }
  }
}

function on(name, handler) {
  if (!listeners.has(name)) {
    listeners.set(name, new Set());
  }

  listeners.get(name).add(handler);

  return () => {
    listeners.get(name)?.delete(handler);
  };
}

function requireClient() {
  if (!client) {
    throw new Error('Matrix client is not initialized.');
  }

  return client;
}

function requireSession() {
  const session = loadSession();

  if (!session?.homeserver || !session?.accessToken || !session?.userId) {
    throw new Error('No active Orbit session.');
  }

  return session;
}

export function getClient() {
  return requireClient();
}

export function getSession() {
  return requireSession();
}

export function getUserId() {
  return requireSession().userId;
}

export function getHomeserver() {
  return requireSession().homeserver;
}

export function getDeviceId() {
  return requireSession().deviceId;
}

export function isInitialized() {
  return Boolean(client);
}

export function isStarted() {
  return started;
}

function bindClientEvents() {
  client.on(ClientEvent.Sync, (state, previousState, data) => {
    emit('sync', state, previousState, data);
  });

  client.on(ClientEvent.Event, (event) => {
    emit('event', event);
  });

  client.on(ClientEvent.Room, (room) => {
    emit('room', room);
  });

  client.on(RoomEvent.MyMembership, (room, membership) => {
    emit('membership', room, membership);
  });

  client.on(RoomEvent.Name, (room) => {
    emit('room.name', room);
  });

  client.on(RoomEvent.Timeline, (...args) => {
    emit('timeline', ...args);
  });

  client.on(RoomEvent.Typing, (event, member) => {
    emit('typing', event, member);
  });

  client.on(RoomEvent.Receipt, (...args) => {
    emit('receipt', ...args);
  });

  client.on(RoomEvent.Redaction, (...args) => {
    emit('redaction', ...args);
  });

  client.on(ClientEvent.Crypto, (...args) => {
    emit('crypto', ...args);
  });

  client.on(ClientEvent.DeviceVerificationChanged, (...args) => {
    emit('verification', ...args);
  });

  client.on(ClientEvent.EventDecrypted, (...args) => {
    emit('decrypted', ...args);
  });

  client.on(ClientEvent.SyncUnexpectedError, (error) => {
    emit('sync.error', error);
  });
}

export async function initialize() {
  if (client) {
    return client;
  }

  const session = requireSession();

  client = createClient({
    baseUrl: session.homeserver,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,

    useAuthorizationHeader: true,

    timelineSupport: true,

    cryptoDatabasePrefix: `orbit-${session.userId}-${session.deviceId}`
  });

  bindClientEvents();

  try {
    await client.initRustCrypto({
      useIndexedDB: true,
      cryptoDatabasePrefix:
        `orbit-crypto-${session.userId}-${session.deviceId}`
    });
  } catch (error) {
    console.error(
      '[Orbit] Rust crypto initialization failed',
      error
    );

    client = null;

    throw new Error(
      'Orbit could not initialize Matrix encryption. ' +
      'Make sure IndexedDB and WebAssembly are available.'
    );
  }

  return client;
}

export async function start() {
  const matrix = await initialize();

  if (started) {
    return matrix;
  }

  started = true;

  syncPromise = matrix.startClient({
    initialSyncLimit: 30,
    lazyLoadMembers: true,
    threadSupport: true
  });

  syncPromise.catch((error) => {
    console.error('[Orbit] Matrix sync failed', error);
    emit('sync.error', error);
  });

  return matrix;
}

export async function stop() {
  if (!client) {
    return;
  }

  try {
    client.stopClient();
  } finally {
    started = false;
    syncPromise = null;
  }
}

export async function logout({
  allDevices = false
} = {}) {
  const matrix = requireClient();

  try {
    await matrix.logout(allDevices);
  } finally {
    clearSession();

    try {
      matrix.stopClient();
    } catch {
      // Already stopped.
    }

    client = null;
    started = false;
  }
}

export function subscribe(name, handler) {
  return on(name, handler);
}

/* ------------------------------------------------------------------
   ROOMS
------------------------------------------------------------------ */

export function getRooms() {
  return requireClient().getVisibleRooms();
}

export function getRoom(roomId) {
  return requireClient().getRoom(roomId);
}

export function getRoomName(room) {
  if (!room) {
    return 'Unknown room';
  }

  return (
    room.name ||
    room.getCanonicalAlias?.() ||
    room.roomId ||
    'Unknown room'
  );
}

export function isRoomEncrypted(room) {
  return Boolean(
    room &&
    (
      room.isRoomEncrypted?.() ||
      room.hasEncryptionStateEvent?.()
    )
  );
}

export async function createRoom({
  name = '',
  invite = [],
  isDirect = false,
  encrypted = true,
  preset = 'private_chat'
} = {}) {
  const matrix = requireClient();

  const initialState = [];

  if (encrypted) {
    initialState.push({
      type: EventType.RoomEncryption,
      state_key: '',
      content: {
        algorithm: 'm.megolm.v1.aes-sha2'
      }
    });
  }

  return matrix.createRoom({
    name: name.trim() || undefined,
    invite: [...new Set(invite.filter(Boolean))],
    is_direct: isDirect,
    preset,
    initial_state: initialState
  });
}

export async function createDM(userId) {
  const normalized = String(userId || '').trim();

  if (!normalized.startsWith('@')) {
    throw new Error('Enter a valid Matrix user ID.');
  }

  const result = await createRoom({
    invite: [normalized],
    isDirect: true,
    encrypted: true,
    preset: 'trusted_private_chat'
  });

  return result.room_id;
}

export async function invite(roomId, userId) {
  return requireClient().invite(roomId, userId);
}

export async function leaveRoom(roomId) {
  return requireClient().leave(roomId);
}

export async function kick(roomId, userId, reason = '') {
  return requireClient().kick(
    roomId,
    userId,
    reason || undefined
  );
}

export async function ban(roomId, userId, reason = '') {
  return requireClient().ban(
    roomId,
    userId,
    reason || undefined
  );
}

export async function unban(roomId, userId) {
  return requireClient().unban(roomId, userId);
}

export async function joinRoom(roomIdOrAlias, via = []) {
  return requireClient().joinRoom(
    roomIdOrAlias,
    {
      via
    }
  );
}

/* ------------------------------------------------------------------
   MESSAGES
------------------------------------------------------------------ */

export async function sendText(
  roomId,
  text,
  {
    html = null,
    replyTo = null,
    msgtype = 'm.text'
  } = {}
) {
  const matrix = requireClient();

  const body = String(text || '').trim();

  if (!body) {
    return null;
  }

  if (replyTo) {
    return sendReply(
      roomId,
      replyTo,
      body,
      { html, msgtype }
    );
  }

  if (html) {
    return matrix.sendHtmlMessage(
      roomId,
      body,
      html
    );
  }

  return matrix.sendMessage(
    roomId,
    {
      msgtype,
      body
    }
  );
}

export async function sendReply(
  roomId,
  event,
  body,
  {
    html = null,
    msgtype = 'm.text'
  } = {}
) {
  const matrix = requireClient();

  const target = event instanceof MatrixEvent
    ? event
    : getEvent(roomId, event);

  if (!target) {
    throw new Error('Reply target could not be found.');
  }

  const eventId = target.getId();

  const fallback = getReplyFallback(target);

  const content = {
    msgtype,
    body: `${fallback}${body}`,
    'm.relates_to': {
      'm.in_reply_to': {
        event_id: eventId
      }
    }
  };

  if (html) {
    content.format = 'org.matrix.custom.html';
    content.formatted_body = html;
  }

  return matrix.sendMessage(
    roomId,
    content
  );
}

function getReplyFallback(event) {
  const sender = event.getSender?.() || '';
  const content = event.getContent?.() || {};
  const body = String(content.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  return body
    ? `> <${sender}> ${body}\n\n`
    : `> <${sender}>\n\n`;
}

export async function editMessage(
  roomId,
  event,
  newBody
) {
  const matrix = requireClient();

  const target = event instanceof MatrixEvent
    ? event
    : getEvent(roomId, event);

  if (!target) {
    throw new Error('Message not found.');
  }

  const eventId = target.getId();
  const body = String(newBody || '').trim();

  if (!body) {
    throw new Error('Edited message cannot be empty.');
  }

  return matrix.sendMessage(
    roomId,
    {
      msgtype: 'm.text',
      body: `* ${body}`,
      'm.new_content': {
        msgtype: 'm.text',
        body
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId
      }
    }
  );
}

export async function redactMessage(
  roomId,
  eventId,
  reason = ''
) {
  return requireClient().redactEvent(
    roomId,
    eventId,
    undefined,
    reason ? { reason } : undefined
  );
}

export async function sendReaction(
  roomId,
  eventId,
  emoji
) {
  return requireClient().sendEvent(
    roomId,
    EventType.Reaction,
    {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: emoji
      }
    }
  );
}

export async function sendEmote(
  roomId,
  text
) {
  return requireClient().sendEmoteMessage(
    roomId,
    text
  );
}

/* ------------------------------------------------------------------
   THREADS
------------------------------------------------------------------ */

export async function sendThreadReply(
  roomId,
  rootEventId,
  text
) {
  return requireClient().sendMessage(
    roomId,
    {
      msgtype: 'm.text',
      body: text,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootEventId,
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: rootEventId
        }
      }
    }
  );
}

/* ------------------------------------------------------------------
   RECEIPTS / TYPING
------------------------------------------------------------------ */

export async function sendReadReceipt(
  event,
  receiptType = 'm.read'
) {
  const matrix = requireClient();

  const target = event instanceof MatrixEvent
    ? event
    : null;

  if (!target) {
    return;
  }

  return matrix.sendReceipt(
    target,
    receiptType
  );
}

export async function markRoomRead(roomId) {
  const room = getRoom(roomId);

  if (!room) {
    return;
  }

  const timeline = room.getLiveTimeline();
  const events = timeline.getEvents();

  const last = [...events]
    .reverse()
    .find((event) => Boolean(event.getId()));

  if (!last) {
    return;
  }

  return requireClient().setRoomReadMarkers(
    roomId,
    last.getId(),
    last.getId()
  );
}

export async function setTyping(
  roomId,
  typing,
  timeout = 5000
) {
  return requireClient().sendTyping(
    roomId,
    typing,
    timeout
  );
}

/* ------------------------------------------------------------------
   MEDIA
------------------------------------------------------------------ */

export async function uploadFile(
  file,
  {
    progress = null,
    encrypt = false
  } = {}
) {
  const matrix = requireClient();

  if (!(file instanceof Blob)) {
    throw new TypeError('Expected a File or Blob.');
  }

  return matrix.uploadContent(
    file,
    {
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
      includeFilename: true,
      encrypt,
      progress
    }
  );
}

export async function sendImage(
  roomId,
  file,
  {
    body = file?.name || 'Image',
    encrypted = isRoomEncrypted(getRoom(roomId))
  } = {}
) {
  const matrix = requireClient();

  if (!(file instanceof Blob)) {
    throw new TypeError('Expected an image file.');
  }

  return matrix.sendImageMessage(
    roomId,
    file,
    {
      name: file.name || 'image',
      type: file.type || 'image/*',
      body,
      encrypt: encrypted
    }
  );
}

export function mxcToHttp(
  mxc,
  {
    width = 1200,
    height = 1200,
    method = 'scale'
  } = {}
) {
  if (!mxc || !mxc.startsWith('mxc://')) {
    return '';
  }

  const matrix = requireClient();

  return matrix.mxcUrlToHttp(
    mxc,
    width,
    height,
    method,
    false,
    false
  ) || '';
}

/* ------------------------------------------------------------------
   SEARCH
------------------------------------------------------------------ */

export async function searchUsers(
  term,
  limit = 20
) {
  const matrix = requireClient();

  const query = String(term || '').trim();

  if (!query) {
    return [];
  }

  const response = await matrix.searchUserDirectory({
    term: query,
    limit
  });

  return response?.results || [];
}

export async function searchMessages(
  searchTerm,
  {
    roomIds = undefined,
    limit = 20
  } = {}
) {
  const matrix = requireClient();

  const body = {
    search_categories: {
      room_events: {
        search_term: searchTerm,
        filter: {
          limit,
          ...(roomIds?.length
            ? { rooms: roomIds }
            : {})
        }
      }
    }
  };

  return matrix.searchMessageText(
    body
  );
}

/* ------------------------------------------------------------------
   PROFILE
------------------------------------------------------------------ */

export async function getProfile(userId = getUserId()) {
  return requireClient().getProfileInfo(userId);
}

export async function setDisplayName(name) {
  return requireClient().setDisplayName(
    String(name || '').trim()
  );
}

export async function setAvatarUrl(mxcUrl) {
  return requireClient().setAvatarUrl(mxcUrl);
}

/* ------------------------------------------------------------------
   ROOM STATE
------------------------------------------------------------------ */

export async function setRoomName(
  roomId,
  name
) {
  return requireClient().setRoomName(
    roomId,
    name
  );
}

export async function setRoomTopic(
  roomId,
  topic
) {
  return requireClient().setRoomTopic(
    roomId,
    topic
  );
}

export async function setRoomAvatar(
  roomId,
  mxcUrl
) {
  return requireClient().sendStateEvent(
    roomId,
    EventType.RoomAvatar,
    {
      url: mxcUrl
    },
    ''
  );
}

export async function getRoomMembers(roomId) {
  const room = getRoom(roomId);

  if (!room) {
    return [];
  }

  return room.getMembers();
}

/* ------------------------------------------------------------------
   EVENT HELPERS
------------------------------------------------------------------ */

export function getEvent(
  roomId,
  eventId
) {
  const room = getRoom(roomId);

  if (!room) {
    return null;
  }

  const timeline = room.getLiveTimeline();

  return timeline
    .getEvents()
    .find((event) => event.getId() === eventId) || null;
}

export function getTimeline(
  roomId,
  limit = 100
) {
  const room = getRoom(roomId);

  if (!room) {
    return [];
  }

  return room
    .getLiveTimeline()
    .getEvents()
    .slice(-limit);
}

export async function paginateBackwards(
  roomId,
  limit = 50
) {
  const room = getRoom(roomId);

  if (!room) {
    return false;
  }

  return requireClient().backPaginateRoomEvents(
    room,
    limit
  );
}

export function getMessageContent(event) {
  const content = event?.getContent?.() || {};

  return {
    msgtype: content.msgtype || 'm.text',
    body: content.body || '',
    formattedBody: content.formatted_body || '',
    format: content.format || '',
    url: content.url || null,
    filename: content.filename || null,
    info: content.info || null,
    relatesTo: content['m.relates_to'] || null,
    newContent: content['m.new_content'] || null
  };
}

export function getSender(event) {
  return event?.getSender?.() || '';
}

export function getEventId(event) {
  return event?.getId?.() || '';
}

export function getTimestamp(event) {
  return event?.getTs?.() || Date.now();
}

export function isOwnEvent(event) {
  return getSender(event) === getUserId();
}

export function isMessageEvent(event) {
  const type = event?.getType?.();

  return (
    type === EventType.RoomMessage ||
    type === EventType.RoomMessageEncrypted
  );
}

export function isRedacted(event) {
  return Boolean(
    event?.isRedactedEvent?.()
  );
}

/* ------------------------------------------------------------------
   CRYPTO
------------------------------------------------------------------ */

export function getCrypto() {
  return requireClient().getCrypto();
}

export function isEncryptionReady() {
  return Boolean(
    requireClient().getCrypto()
  );
}

export async function requestVerification(
  userId,
  deviceId
) {
  const matrix = requireClient();

  const crypto = matrix.getCrypto();

  if (!crypto) {
    throw new Error('Matrix encryption is not initialized.');
  }

  const verification = await crypto.requestDeviceVerification(
    userId,
    deviceId
  );

  return verification;
}

export async function requestVerificationForUser(
  userId
) {
  const matrix = requireClient();

  const crypto = matrix.getCrypto();

  if (!crypto) {
    throw new Error('Matrix encryption is not initialized.');
  }

  return crypto.requestVerificationDM(
    userId
  );
}

export async function getUserDevices(userId) {
  const matrix = requireClient();

  return matrix.getCrypto()?.getUserDeviceInfo(
    userId
  );
}

export async function trustDevice(
  userId,
  deviceId
) {
  const matrix = requireClient();
  const crypto = matrix.getCrypto();

  if (!crypto) {
    throw new Error('Matrix encryption is not initialized.');
  }

  return crypto.setDeviceVerified(
    userId,
    deviceId
  );
}

export async function resetCrypto() {
  const matrix = requireClient();
  const crypto = matrix.getCrypto();

  if (!crypto) {
    return;
  }

  await crypto.resetKeyBackup?.();
}

export function getSyncState() {
  return requireClient().getSyncState();
}

export {
  client,
  loadSession,
  saveSession,
  clearSession
};