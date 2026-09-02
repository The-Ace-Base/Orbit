import {
  createClient,
  ClientEvent,
  RoomEvent
} from 'matrix-js-sdk';

const SESSION_KEY = 'orbit.session';

let client = null;
let cryptoReady = false;

const listeners = new Set();

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return null;

    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getSession() {
  return loadSession();
}

export function getClient() {
  return client;
}

export function onMatrixEvent(callback) {
  listeners.add(callback);

  return () => {
    listeners.delete(callback);
  };
}

function emit(type, payload = {}) {
  for (const callback of listeners) {
    try {
      callback({
        type,
        ...payload
      });
    } catch (error) {
      console.error('Orbit event listener failed:', error);
    }
  }
}

export async function initializeMatrix() {
  const session = loadSession();

  if (!session?.homeserver || !session?.accessToken) {
    throw new Error('No active Matrix session.');
  }

  if (client) {
    return client;
  }

  client = createClient({
    baseUrl: session.homeserver,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId || undefined,

    timelineSupport: true,

    store: undefined
  });

  try {
    await client.initRustCrypto({
      useIndexedDB: true,
      cryptoDatabasePrefix: 'orbit'
    });

    cryptoReady = true;

    emit('crypto', {
      ready: true
    });
  } catch (error) {
    console.warn(
      'Orbit: Rust crypto initialization failed.',
      error
    );

    cryptoReady = false;

    emit('crypto', {
      ready: false,
      error
    });
  }

  attachClientEvents();

  return client;
}

function attachClientEvents() {
  if (!client) return;

  client.on(
    ClientEvent.Sync,
    (state, prevState, data) => {
      emit('sync', {
        state,
        previousState: prevState,
        data
      });
    }
  );

  client.on(
    ClientEvent.Event,
    event => {
      emit('event', {
        event
      });
    }
  );

  client.on(
    RoomEvent.Timeline,
    (event, room, toStartOfTimeline) => {
      emit('timeline', {
        event,
        room,
        toStartOfTimeline
      });
    }
  );

  client.on(
    RoomEvent.Name,
    room => {
      emit('room-updated', {
        room
      });
    }
  );

  client.on(
    RoomEvent.MyMembership,
    (room, membership) => {
      emit('membership', {
        room,
        membership
      });
    }
  );

  client.on(
    RoomEvent.UnreadNotifications,
    room => {
      emit('unread', {
        room
      });
    }
  );

  client.on(
    RoomEvent.Receipt,
    (event, room) => {
      emit('receipt', {
        event,
        room
      });
    }
  );
}

export async function start() {
  if (!client) {
    await initializeMatrix();
  }

  client.startClient({
    initialSyncLimit: 30,
    lazyLoadMembers: true
  });
}

export function stop() {
  client?.stopClient();
}

export function isCryptoReady() {
  return cryptoReady;
}

export function getRooms() {
  return client?.getVisibleRooms?.() ||
    client?.getRooms?.() ||
    [];
}

export function getRoom(roomId) {
  return client?.getRoom(roomId) || null;
}

export function getUserId() {
  return client?.getUserId() || loadSession()?.userId || '';
}

export function getDeviceId() {
  return client?.getDeviceId() || loadSession()?.deviceId || '';
}

export function getHomeserver() {
  return client?.getHomeserverUrl() ||
    loadSession()?.homeserver ||
    '';
}

export function getDisplayName() {
  const userId = getUserId();

  const user = client?.getUser(userId);

  return (
    user?.displayName ||
    userId ||
    'Matrix'
  );
}

export async function sendText(roomId, body) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  const text = String(body || '').trim();

  if (!text) return null;

  return client.sendTextMessage(
    roomId,
    text
  );
}

export async function sendEmote(roomId, body) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  return client.sendEmoteMessage(
    roomId,
    body
  );
}

export async function sendReaction(
  roomId,
  eventId,
  emoji
) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  return client.sendEvent(
    roomId,
    'm.reaction',
    {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: emoji
      }
    }
  );
}

export async function redact(
  roomId,
  eventId,
  reason = ''
) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  return client.redactEvent(
    roomId,
    eventId,
    reason
      ? { reason }
      : undefined
  );
}

export async function sendTyping(
  roomId,
  typing
) {
  if (!client) return;

  return client.sendTyping(
    roomId,
    typing,
    8000
  );
}

export async function markRead(event) {
  if (!client || !event) return;

  try {
    await client.sendReadReceipt(event);
  } catch (error) {
    console.warn(
      'Orbit: unable to send read receipt.',
      error
    );
  }
}

export async function createDirectMessage(
  userId
) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  const target = String(userId || '').trim();

  if (!/^@[^:]+:.+$/.test(target)) {
    throw new Error(
      'Enter a valid Matrix ID such as @user:example.org.'
    );
  }

  const existing = findDirectRoom(target);

  if (existing) {
    return existing.roomId;
  }

  const result = await client.createRoom({
    invite: [target],
    is_direct: true,

    initial_state: []
  });

  return result.room_id;
}

function findDirectRoom(userId) {
  const rooms = getRooms();

  for (const room of rooms) {
    const members = room.getMembers();

    const hasTarget = members.some(
      member =>
        member.userId === userId &&
        member.membership !== 'leave'
    );

    const hasOnlyTwo =
      members.filter(
        member =>
          member.membership === 'join' ||
          member.membership === 'invite'
      ).length <= 2;

    if (hasTarget && hasOnlyTwo) {
      return room;
    }
  }

  return null;
}

export async function searchUsers(term) {
  if (!client) return [];

  const query = String(term || '').trim();

  if (!query) return [];

  try {
    const response =
      await client.searchUserDirectory({
        term: query,
        limit: 10
      });

    return response?.results || [];
  } catch (error) {
    console.warn(
      'Orbit: user search failed.',
      error
    );

    return [];
  }
}

export async function setDisplayName(name) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  return client.setDisplayName(
    String(name || '').trim()
  );
}

export async function uploadFile(file) {
  if (!client) {
    throw new Error('Matrix client is not ready.');
  }

  return client.uploadContent(
    file,
    {
      includeFilename: true,
      onlyContentUri: true
    }
  );
}

export async function sendFile(
  roomId,
  file
) {
  const upload = await uploadFile(file);

  const url =
    typeof upload === 'string'
      ? upload
      : upload?.content_uri;

  if (!url) {
    throw new Error(
      'The homeserver did not return a media URL.'
    );
  }

  if (file.type.startsWith('image/')) {
    return client.sendImageMessage(
      roomId,
      url,
      {
        mimetype: file.type,
        size: file.size,
        w: 0,
        h: 0
      },
      file.name
    );
  }

  return client.sendMessage(
    roomId,
    {
      msgtype: 'm.file',
      body: file.name,
      url,
      info: {
        mimetype: file.type || 'application/octet-stream',
        size: file.size
      }
    }
  );
}

export function mediaUrl(mxc, width = 96, height = 96) {
  if (!mxc || !client) return '';

  try {
    return client.mxcUrlToHttp(
      mxc,
      width,
      height,
      'crop',
      false,
      false
    ) || '';
  } catch {
    return '';
  }
}

export function getRoomEvents(room) {
  if (!room) return [];

  return room
    .getLiveTimeline()
    ?.getEvents?.() || [];
}

export async function paginateRoom(
  room,
  limit = 30
) {
  if (!client || !room) return;

  return client.scrollback(
    room,
    limit
  );
}

export function getRoomMembers(room) {
  return room?.getMembers?.() || [];
}

export function getRoomName(room) {
  if (!room) return 'Conversation';

  return (
    room.name ||
    room.getCanonicalAlias?.() ||
    room.roomId ||
    'Conversation'
  );
}

export function getMemberName(
  room,
  userId
) {
  const member = room?.getMember?.(userId);

  return (
    member?.name ||
    member?.rawDisplayName ||
    userId ||
    'Unknown'
  );
}

export function isEncrypted(room) {
  if (!room) return false;

  return Boolean(
    room.hasEncryptionStateEvent?.() ||
    room.getLiveTimeline?.()
      ?.getState?.('b')?.getStateEvents?.(
        'm.room.encryption',
        ''
      )
  );
}

export async function leaveRoom(roomId) {
  if (!client) return;

  return client.leave(roomId);
}

export async function logout() {
  try {
    await client?.logout(true);
  } catch (error) {
    console.warn(
      'Orbit logout warning:',
      error
    );
  }

  stop();

  client = null;

  localStorage.removeItem(
    SESSION_KEY
  );
}