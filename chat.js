import {
  getClient,
  initializeMatrix,
  start,
  stop,
  getRooms,
  getRoomName,
  getMemberName,
  getRoomEvents,
  getUserId,
  getDisplayName,
  getHomeserver,
  sendText,
  sendTyping,
  markRead,
  createDirectMessage,
  searchUsers,
  setDisplayName,
  logout,
  mediaUrl,
  sendFile,
  onMatrixEvent,
  isCryptoReady
} from './matrix.js';

import {
  loadEmoji,
  getGroups,
  getGroupIcon,
  searchEmoji,
  getRecentEmoji,
  rememberEmoji
} from './unicode.js';

const THEME_KEY = 'orbit-theme';

const session = (() => {
  try {
    return JSON.parse(
      localStorage.getItem('orbit.session') || 'null'
    );
  } catch {
    return null;
  }
})();

if (!session) {
  window.location.replace('./index.html');
  throw new Error('No Orbit session.');
}

const $ = selector =>
  document.querySelector(selector);

const roomList = $('#room-list');
const roomSearch = $('#room-search');
const roomCount = $('#room-count');

const messageList = $('#message-list');
const emptyState = $('#empty-state');
const chatView = $('#chat-view');

const chatName = $('#chat-name');
const chatStatus = $('#chat-status');

const chatAvatar = $('#chat-avatar');
const chatAvatarFallback = $('#chat-avatar-fallback');

const sidebarUser = $('#sidebar-user');
const connectionStatus = $('#connection-status');

const composer = $('#composer');
const messageInput = $('#message-input');
const sendButton = $('#send-button');

const typingIndicator = $('#typing-indicator');

const emojiButton = $('#emoji-button');
const emojiPicker = $('#emoji-picker');
const emojiSearch = $('#emoji-search');
const emojiGrid = $('#emoji-grid');
const emojiCategories = $('#emoji-categories');
const emojiTone = $('#emoji-tone');

const fileInput = $('#file-input');
const attachButton = $('#attach-button');

const dmModal = $('#dm-modal');
const dmForm = $('#dm-form');
const dmUser = $('#dm-user');
const dmResults = $('#dm-results');
const dmError = $('#dm-error');

const profileModal = $('#profile-modal');
const profileForm = $('#profile-form');
const profileName = $('#profile-name');
const profileError = $('#profile-error');

const profileAvatar = $('#profile-avatar');
const profileLargeAvatar = $('#profile-large-avatar');
const profileUserId = $('#profile-user-id');

const toast = $('#toast');

let activeRoomId = null;
let roomFilter = '';
let typingTimer = null;
let isSending = false;

let currentEmojiGroup = '';
let emojiToneIndex = 0;

const roomState = new Map();

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  localStorage.setItem(
    THEME_KEY,
    theme
  );

  document.querySelectorAll(
    '#theme-toggle i, #auth-theme-toggle i'
  ).forEach(icon => {
    icon.className =
      theme === 'dark'
        ? 'hgi-stroke hgi-sun-03'
        : 'hgi-stroke hgi-moon-02';
  });
}

function initialTheme() {
  const saved =
    localStorage.getItem(THEME_KEY);

  if (saved === 'dark' || saved === 'light') {
    return saved;
  }

  return window.matchMedia(
    '(prefers-color-scheme: dark)'
  ).matches
    ? 'dark'
    : 'light';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function linkify(value) {
  const escaped = escapeHtml(value);

  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function formatTime(timestamp) {
  if (!timestamp) return '';

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: 'numeric',
      minute: '2-digit'
    }
  ).format(timestamp);
}

function formatRoomTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();

  if (
    date.toDateString() ===
    now.toDateString()
  ) {
    return new Intl.DateTimeFormat(
      undefined,
      {
        hour: 'numeric',
        minute: '2-digit'
      }
    ).format(date);
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      month: 'short',
      day: 'numeric'
    }
  ).format(date);
}

function initials(name) {
  const parts =
    String(name || 'O')
      .trim()
      .split(/\s+/)
      .slice(0, 2);

  return parts
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function roomPreview(room) {
  const events = getRoomEvents(room);

  const last = [...events]
    .reverse()
    .find(event => {
      const type = event.getType();

      return (
        type === 'm.room.message' ||
        type === 'm.room.encrypted'
      );
    });

  if (!last) {
    return 'No messages yet';
  }

  if (
    last.getType() ===
    'm.room.encrypted'
  ) {
    return 'Encrypted message';
  }

  const content =
    last.getContent();

  if (
    content.msgtype ===
    'm.image'
  ) {
    return 'Photo';
  }

  if (
    content.msgtype ===
    'm.file'
  ) {
    return 'File';
  }

  return (
    content.body ||
    'Message'
  );
}

function setConnection(
  state,
  text
) {
  connectionStatus.dataset.state =
    state;

  connectionStatus.textContent =
    text;
}

function toastMessage(message) {
  toast.textContent = message;

  toast.classList.add('visible');

  clearTimeout(
    toastMessage.timer
  );

  toastMessage.timer =
    setTimeout(() => {
      toast.classList.remove(
        'visible'
      );
    }, 2600);
}

function renderRoomList() {
  const rooms = getRooms()
    .filter(room => {
      if (!roomFilter) return true;

      const name =
        getRoomName(room)
          .toLowerCase();

      return name.includes(
        roomFilter.toLowerCase()
      );
    })
    .sort((a, b) => {
      const aEvents =
        getRoomEvents(a);

      const bEvents =
        getRoomEvents(b);

      const aLast =
        aEvents.at(-1)
          ?.getTs?.() || 0;

      const bLast =
        bEvents.at(-1)
          ?.getTs?.() || 0;

      return bLast - aLast;
    });

  roomCount.textContent =
    rooms.length;

  roomList.innerHTML = '';

  if (!rooms.length) {
    roomList.innerHTML = `
      <div class="room-empty">
        <i class="hgi-stroke hgi-search-01"></i>
        <span>No conversations found.</span>
      </div>
    `;

    return;
  }

  for (const room of rooms) {
    const item =
      document.createElement('button');

    item.type = 'button';
    item.className =
      'room-item';

    if (
      room.roomId ===
      activeRoomId
    ) {
      item.classList.add(
        'active'
      );
    }

    const name =
      getRoomName(room);

    const events =
      getRoomEvents(room);

    const last =
      events.at(-1);

    const unread =
      room.getUnreadNotificationCount?.(
        'total'
      ) || 0;

    const avatarUrl =
      room.getAvatarUrl?.(
        getHomeserver(),
        84,
        84,
        'crop'
      );

    item.innerHTML = `
      <div class="room-avatar">
        ${
          avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="">`
            : escapeHtml(initials(name))
        }
      </div>

      <div class="room-copy">
        <strong>
          ${escapeHtml(name)}
        </strong>

        <span>
          ${escapeHtml(roomPreview(room))}
        </span>
      </div>

      <div class="room-meta">
        <time>
          ${
            formatRoomTime(
              last?.getTs?.()
            )
          }
        </time>

        ${
          unread
            ? `<b>${unread > 99 ? '99+' : unread}</b>`
            : ''
        }
      </div>
    `;

    item.addEventListener(
      'click',
      () => selectRoom(room.roomId)
    );

    roomList.appendChild(item);
  }
}

async function selectRoom(roomId) {
  const room =
    getClient()?.getRoom(roomId);

  if (!room) return;

  activeRoomId =
    roomId;

  emptyState.classList.add(
    'hidden'
  );

  chatView.classList.remove(
    'hidden'
  );

  renderRoomList();
  renderHeader(room);
  renderMessages(room);

  const events =
    getRoomEvents(room);

  const last =
    events.at(-1);

  if (last) {
    await markRead(last);
  }

  if (
    window.innerWidth < 900
  ) {
    document.body.classList.add(
      'room-open'
    );
  }

  messageInput.focus();
}

function renderHeader(room) {
  const name =
    getRoomName(room);

  chatName.textContent =
    name;

  const members =
    room.getJoinedMembers?.() ||
    room.getMembers?.() ||
    [];

  chatStatus.textContent =
    `${members.length || 1} ${
      members.length === 1
        ? 'member'
        : 'members'
    }`;

  const avatar =
    room.getAvatarUrl?.(
      getHomeserver(),
      96,
      96,
      'crop'
    );

  if (avatar) {
    chatAvatar.src =
      avatar;

    chatAvatar.hidden =
      false;

    chatAvatarFallback.hidden =
      true;
  } else {
    chatAvatar.hidden =
      true;

    chatAvatarFallback.hidden =
      false;

    chatAvatarFallback.innerHTML =
      `<span>${escapeHtml(initials(name))}</span>`;
  }
}

function renderMessages(room) {
  const events =
    getRoomEvents(room);

  messageList.innerHTML = '';

  if (!events.length) {
    messageList.innerHTML = `
      <div class="messages-empty">
        <div class="messages-empty-mark">
          <i class="hgi-stroke hgi-message-01"></i>
        </div>

        <strong>
          This is the beginning.
        </strong>

        <span>
          Send the first message.
        </span>
      </div>
    `;

    return;
  }

  const visible =
    events.filter(event => {
      const type =
        event.getType();

      return (
        type === 'm.room.message' ||
        type === 'm.room.encrypted'
      );
    });

  let lastDate = '';

  for (const event of visible) {
    const timestamp =
      event.getTs?.() || Date.now();

    const date =
      new Date(timestamp)
        .toDateString();

    if (date !== lastDate) {
      const divider =
        document.createElement('div');

      divider.className =
        'date-divider';

      divider.innerHTML = `
        <span>
          ${escapeHtml(
            new Intl.DateTimeFormat(
              undefined,
              {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              }
            ).format(timestamp)
          )}
        </span>
      `;

      messageList.appendChild(
        divider
      );

      lastDate = date;
    }

    const node =
      renderMessage(
        event,
        room
      );

    if (node) {
      messageList.appendChild(
        node
      );
    }
  }

  requestAnimationFrame(() => {
    messageList.scrollTop =
      messageList.scrollHeight;
  });
}

function renderMessage(event, room) {
  const type =
    event.getType();

  const content =
    event.getContent();

  const sender =
    event.getSender();

  const own =
    sender === getUserId();

  const row =
    document.createElement('article');

  row.className =
    `message-row ${own ? 'own' : 'other'}`;

  row.dataset.eventId =
    event.getId?.() || '';

  if (
    type === 'm.room.encrypted'
  ) {
    row.innerHTML = `
      <div class="message-bubble encrypted">
        <div class="encrypted-icon">
          <i class="hgi-stroke hgi-lock"></i>
        </div>

        <div>
          <strong>Encrypted message</strong>
          <span>
            ${
              isCryptoReady()
                ? 'Decrypting with your device…'
                : 'Encryption unavailable in this session.'
            }
          </span>
        </div>
      </div>
    `;

    return row;
  }

  const body =
    content.body || '';

  const msgType =
    content.msgtype;

  const senderName =
    own
      ? 'You'
      : getMemberName(
          room,
          sender
        );

  const avatar =
    own
      ? ''
      : initials(senderName);

  let contentHtml = '';

  if (
    msgType === 'm.image' &&
    content.url
  ) {
    const image =
      mediaUrl(
        content.url,
        640,
        640
      );

    contentHtml = `
      <a
        class="message-image"
        href="${escapeHtml(image || content.url)}"
        target="_blank"
        rel="noopener"
      >
        <img
          src="${escapeHtml(image || content.url)}"
          alt="${escapeHtml(body)}"
          loading="lazy"
        >
      </a>

      ${
        body
          ? `<p>${linkify(body)}</p>`
          : ''
      }
    `;
  } else if (
    msgType === 'm.file' &&
    content.url
  ) {
    const fileUrl =
      mediaUrl(
        content.url
      ) || content.url;

    contentHtml = `
      <a
        class="file-card"
        href="${escapeHtml(fileUrl)}"
        target="_blank"
        rel="noopener"
      >
        <i class="hgi-stroke hgi-file-02"></i>

        <span>
          <strong>
            ${escapeHtml(body || 'File')}
          </strong>

          <small>
            Open attachment
          </small>
        </span>
      </a>
    `;
  } else {
    contentHtml = `
      <p>
        ${linkify(body)}
      </p>
    `;
  }

  row.innerHTML = `
    ${
      own
        ? ''
        : `
          <div class="message-avatar">
            ${escapeHtml(avatar)}
          </div>
        `
    }

    <div class="message-column">

      ${
        own
          ? ''
          : `
            <span class="message-author">
              ${escapeHtml(senderName)}
            </span>
          `
      }

      <div class="message-bubble">

        ${contentHtml}

        <div class="message-meta">
          <time>
            ${formatTime(event.getTs?.())}
          </time>

          ${
            own
              ? `
                <i
                  class="hgi-stroke hgi-checkmark-02"
                  aria-label="Sent"
                ></i>
              `
              : ''
          }
        </div>

      </div>

    </div>
  `;

  return row;
}

function updateTyping() {
  if (!activeRoomId) return;

  clearTimeout(
    typingTimer
  );

  typingTimer =
    setTimeout(() => {
      sendTyping(
        activeRoomId,
        false
      ).catch(() => {});
    }, 1200);
}

async function submitMessage() {
  if (
    isSending ||
    !activeRoomId
  ) {
    return;
  }

  const text =
    messageInput.value.trim();

  if (!text) return;

  isSending = true;

  sendButton.disabled =
    true;

  try {
    await sendText(
      activeRoomId,
      text
    );

    messageInput.value = '';

    resizeComposer();

    sendTyping(
      activeRoomId,
      false
    ).catch(() => {});

    const room =
      getClient()?.getRoom(
        activeRoomId
      );

    if (room) {
      renderMessages(room);
    }
  } catch (error) {
    toastMessage(
      error?.message ||
      'Message could not be sent.'
    );
  } finally {
    isSending = false;
    sendButton.disabled = false;
    messageInput.focus();
  }
}

function resizeComposer() {
  messageInput.style.height =
    'auto';

  messageInput.style.height =
    `${Math.min(
      messageInput.scrollHeight,
      160
    )}px`;
}

function renderEmojiPicker() {
  emojiGrid.innerHTML = '';

  const items =
    emojiSearch.value.trim()
      ? searchEmoji(
          emojiSearch.value,
          ''
        )
      : (
          currentEmojiGroup
            ? searchEmoji(
                '',
                currentEmojiGroup
              )
            : getRecentEmoji()
        );

  if (!items.length) {
    emojiGrid.innerHTML = `
      <div class="emoji-empty">
        No emoji found.
      </div>
    `;

    return;
  }

  const fragment =
    document.createDocumentFragment();

  for (const item of items) {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.className =
      'emoji-item';

    button.title =
      item.name;

    button.textContent =
      item.emoji;

    button.addEventListener(
      'click',
      () => {
        insertEmoji(
          item.emoji
        );

        rememberEmoji(
          item.emoji
        );
      }
    );

    fragment.appendChild(
      button
    );
  }

  emojiGrid.appendChild(
    fragment
  );
}

function renderEmojiCategories() {
  emojiCategories.innerHTML = '';

  const groups = [
    '',
    ...getGroups()
  ];

  for (const group of groups) {
    const button =
      document.createElement('button');

    button.type = 'button';

    button.className =
      'emoji-category';

    if (
      group === currentEmojiGroup
    ) {
      button.classList.add(
        'active'
      );
    }

    button.title =
      group || 'Recent';

    button.textContent =
      group
        ? getGroupIcon(group)
        : '◷';

    button.addEventListener(
      'click',
      () => {
        currentEmojiGroup =
          group;

        emojiSearch.value =
          '';

        renderEmojiCategories();
        renderEmojiPicker();
      }
    );

    emojiCategories.appendChild(
      button
    );
  }
}

function insertEmoji(emoji) {
  const start =
    messageInput.selectionStart;

  const end =
    messageInput.selectionEnd;

  const value =
    messageInput.value;

  messageInput.value =
    `${value.slice(0, start)}${emoji}${value.slice(end)}`;

  const cursor =
    start + emoji.length;

  messageInput.selectionStart =
    cursor;

  messageInput.selectionEnd =
    cursor;

  messageInput.focus();

  resizeComposer();
}

function toggleEmojiPicker() {
  const hidden =
    emojiPicker.classList.contains(
      'hidden'
    );

  emojiPicker.classList.toggle(
    'hidden',
    !hidden
  );

  emojiButton.setAttribute(
    'aria-expanded',
    String(hidden)
  );

  if (hidden) {
    renderEmojiCategories();
    renderEmojiPicker();
  }
}

async function openDM() {
  dmError.textContent = '';
  dmUser.value = '';
  dmResults.innerHTML = '';

  dmModal.showModal();

  setTimeout(() => {
    dmUser.focus();
  }, 50);
}

async function handleDMSubmit() {
  const user =
    dmUser.value.trim();

  if (!user) {
    dmError.textContent =
      'Enter a Matrix ID.';

    return;
  }

  const startButton =
    $('#start-dm');

  startButton.disabled =
    true;

  dmError.textContent = '';

  try {
    const roomId =
      await createDirectMessage(
        user
      );

    dmModal.close();

    await selectRoom(roomId);

    toastMessage(
      'Conversation created.'
    );
  } catch (error) {
    dmError.textContent =
      error?.message ||
      'Could not create conversation.';
  } finally {
    startButton.disabled =
      false;
  }
}

function openProfile() {
  profileError.textContent = '';

  const userId =
    getUserId();

  profileUserId.textContent =
    userId;

  profileName.value =
    getDisplayName();

  profileAvatar.textContent =
    initials(
      getDisplayName()
    );

  profileLargeAvatar.textContent =
    initials(
      getDisplayName()
    );

  profileModal.showModal();
}

async function saveProfile() {
  const name =
    profileName.value.trim();

  if (!name) {
    profileError.textContent =
      'Enter a display name.';

    return;
  }

  try {
    await setDisplayName(name);

    sidebarUser.textContent =
      name;

    profileAvatar.textContent =
      initials(name);

    profileLargeAvatar.textContent =
      initials(name);

    profileModal.close();

    toastMessage(
      'Profile updated.'
    );
  } catch (error) {
    profileError.textContent =
      error?.message ||
      'Could not update profile.';
  }
}

function bindEvents() {
  $('#theme-toggle')
    ?.addEventListener(
      'click',
      () => {
        const current =
          document.documentElement
            .dataset.theme;

        applyTheme(
          current === 'dark'
            ? 'light'
            : 'dark'
        );
      }
    );

  roomSearch.addEventListener(
    'input',
    event => {
      roomFilter =
        event.target.value;

      renderRoomList();
    }
  );

  $('#new-dm-btn')
    .addEventListener(
      'click',
      openDM
    );

  $('#cancel-dm')
    .addEventListener(
      'click',
      () => dmModal.close()
    );

  $('#close-dm')
    .addEventListener(
      'click',
      () => dmModal.close()
    );

  dmForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      handleDMSubmit();
    }
  );

  $('#profile-btn')
    .addEventListener(
      'click',
      openProfile
    );

  $('#close-profile')
    .addEventListener(
      'click',
      () => profileModal.close()
    );

  profileForm.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      saveProfile();
    }
  );

  $('#logout-btn')
    .addEventListener(
      'click',
      async () => {
        await logout();

        window.location.replace(
          './index.html'
        );
      }
    );

  $('#back-btn')
    .addEventListener(
      'click',
      () => {
        document.body.classList.remove(
          'room-open'
        );
      }
    );

  composer.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      submitMessage();
    }
  );

  messageInput.addEventListener(
    'input',
    () => {
      resizeComposer();

      if (activeRoomId) {
        sendTyping(
          activeRoomId,
          true
        ).catch(() => {});

        updateTyping();
      }
    }
  );

  messageInput.addEventListener(
    'keydown',
    event => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        submitMessage();
      }
    }
  );

  emojiButton.addEventListener(
    'click',
    toggleEmojiPicker
  );

  emojiSearch.addEventListener(
    'input',
    renderEmojiPicker
  );

  emojiTone.addEventListener(
    'click',
    () => {
      emojiToneIndex =
        (emojiToneIndex + 1) % 6;

      emojiTone.textContent =
        emojiToneIndex === 0
          ? '●'
          : [
              '🏻',
              '🏼',
              '🏽',
              '🏾',
              '🏿'
            ][emojiToneIndex - 1];
    }
  );

  attachButton.addEventListener(
    'click',
    () => fileInput.click()
  );

  fileInput.addEventListener(
    'change',
    async () => {
      if (!activeRoomId) return;

      const files =
        [...fileInput.files];

      for (const file of files) {
        try {
          await sendFile(
            activeRoomId,
            file
          );
        } catch (error) {
          toastMessage(
            error?.message ||
            'Attachment failed.'
          );
        }
      }

      fileInput.value = '';
    }
  );

  document.addEventListener(
    'click',
    event => {
      if (
        !emojiPicker.contains(
          event.target
        ) &&
        !emojiButton.contains(
          event.target
        )
      ) {
        emojiPicker.classList.add(
          'hidden'
        );

        emojiButton.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    }
  );

  document.addEventListener(
    'keydown',
    event => {
      if (
        event.key === '/' &&
        document.activeElement !==
          messageInput &&
        document.activeElement !==
          roomSearch
      ) {
        event.preventDefault();
        roomSearch.focus();
      }

      if (
        event.key.toLowerCase() === 'n' &&
        !event.metaKey &&
        !event.ctrlKey &&
        document.activeElement.tagName !==
          'INPUT' &&
        document.activeElement.tagName !==
          'TEXTAREA'
      ) {
        openDM();
      }

      if (
        event.key === 'Escape'
      ) {
        emojiPicker.classList.add(
          'hidden'
        );
      }
    }
  );
}

function handleMatrixEvent(data) {
  if (
    data.type === 'sync'
  ) {
    if (
      data.state === 'PREPARED' ||
      data.state === 'SYNCING'
    ) {
      setConnection(
        'connected',
        'Connected'
      );
    }

    if (
      data.state === 'ERROR'
    ) {
      setConnection(
        'error',
        'Connection error'
      );
    }

    renderRoomList();

    if (activeRoomId) {
      const room =
        getClient()?.getRoom(
          activeRoomId
        );

      if (room) {
        renderMessages(room);
      }
    }
  }

  if (
    data.type === 'timeline' ||
    data.type === 'room-updated' ||
    data.type === 'unread'
  ) {
    renderRoomList();

    if (
      activeRoomId &&
      data.room?.roomId ===
        activeRoomId
    ) {
      renderMessages(
        data.room
      );
    }
  }

  if (
    data.type === 'membership'
  ) {
    renderRoomList();
  }
}

async function boot() {
  applyTheme(
    initialTheme()
  );

  sidebarUser.textContent =
    getDisplayName();

  profileAvatar.textContent =
    initials(
      getDisplayName()
    );

  profileLargeAvatar.textContent =
    initials(
      getDisplayName()
    );

  profileUserId.textContent =
    getUserId();

  bindEvents();

  onMatrixEvent(
    handleMatrixEvent
  );

  try {
    setConnection(
      'warning',
      'Starting'
    );

    await initializeMatrix();

    await loadEmoji();

    await start();

    setConnection(
      'connected',
      'Connected'
    );

    renderEmojiCategories();
    renderEmojiPicker();
    renderRoomList();
  } catch (error) {
    console.error(error);

    setConnection(
      'error',
      'Offline'
    );

    toastMessage(
      error?.message ||
      'Orbit could not start.'
    );
  }
}

window.addEventListener(
  'beforeunload',
  () => {
    stop();
  }
);

boot();