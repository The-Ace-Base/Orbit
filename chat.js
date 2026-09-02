import * as Matrix from './matrix.js';

import {
  init as initUnicode,
  getCategories,
  getCategoryEmoji,
  getRecentEmoji,
  searchEmoji,
  useEmoji,
  insertAtCursor,
  getMetadata
} from './unicode.js';

const THEME_KEY = 'orbit-theme';

const $ = (selector) =>
  document.querySelector(selector);

const $$ = (selector) =>
  [...document.querySelectorAll(selector)];

let selectedRoomId = null;
let replyEvent = null;
let roomFilter = '';
let typingTimer = null;
let lastReadEventId = null;

const roomCache = new Map();

/* ------------------------------------------------------------------
   DOM
------------------------------------------------------------------ */

const roomList = $('#room-list');
const roomSearch = $('#room-search');
const sidebarUser = $('#sidebar-user');
const connectionStatus = $('#connection-status');

const emptyState = $('#empty-state');
const chatView = $('#chat-view');
const messageList = $('#message-list');
const chatName = $('#chat-name');
const chatStatus = $('#chat-status');
const chatAvatar = $('#chat-avatar');
const chatAvatarFallback = $('#chat-avatar-fallback');

const composer = $('#composer');
const messageInput = $('#message-input');
const sendButton = $('#send-button');
const typingIndicator = $('#typing-indicator');

const emojiButton = $('#emoji-button');
const emojiPicker = $('#emoji-picker');
const emojiSearch = $('#emoji-search');
const emojiCategories = $('#emoji-categories');
const emojiGrid = $('#emoji-grid');

const fileInput = $('#file-input');
const attachButton = $('#attach-button');

const replyPreview = $('#reply-preview');
const replyAuthor = $('#reply-author');
const replyBody = $('#reply-body');
const cancelReply = $('#cancel-reply');

const dmModal = $('#dm-modal');
const dmForm = $('#dm-form');
const dmUser = $('#dm-user');
const dmResults = $('#dm-results');
const dmError = $('#dm-error');

const profileModal = $('#profile-modal');
const profileForm = $('#profile-form');
const profileName = $('#profile-name');
const profileError = $('#profile-error');

/* ------------------------------------------------------------------
   THEME
------------------------------------------------------------------ */

function applyTheme() {
  const theme = localStorage.getItem(THEME_KEY);

  if (
    theme === 'light' ||
    theme === 'dark'
  ) {
    document.documentElement.dataset.theme = theme;
  }
}

function toggleTheme() {
  const current =
    document.documentElement.dataset.theme ||
    (
      matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    );

  const next =
    current === 'dark'
      ? 'light'
      : 'dark';

  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
}

$('#theme-toggle').addEventListener(
  'click',
  toggleTheme
);

/* ------------------------------------------------------------------
   UTILITIES
------------------------------------------------------------------ */

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);

  return new Intl.DateTimeFormat(
    undefined,
    {
      hour: 'numeric',
      minute: '2-digit'
    }
  ).format(date);
}

function formatDay(timestamp) {
  const date = new Date(timestamp);

  return new Intl.DateTimeFormat(
    undefined,
    {
      day: 'numeric',
      month: 'short',
      year:
        date.getFullYear() !==
        new Date().getFullYear()
          ? 'numeric'
          : undefined
    }
  ).format(date);
}

function formatRelativeDate(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);

  const sameDay =
    now.toDateString() === date.toDateString();

  if (sameDay) {
    return formatTime(timestamp);
  }

  return formatDay(timestamp);
}

function linkify(text) {
  const escaped = escapeHtml(text);

  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

function debounce(
  callback,
  delay = 250
) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(
      () => callback(...args),
      delay
    );
  };
}

function roomName(room) {
  return Matrix.getRoomName(room);
}

function getMemberName(
  room,
  userId
) {
  const member = room?.getMember?.(userId);

  return (
    member?.name ||
    member?.rawDisplayName ||
    userId
  );
}

function getAvatarUrl(room) {
  const avatar = room?.getAvatarUrl?.(
    Matrix.getHomeserver(),
    96,
    96,
    'crop'
  );

  return avatar || '';
}

/* ------------------------------------------------------------------
   CONNECTION
------------------------------------------------------------------ */

function setConnectionStatus(
  text,
  state = ''
) {
  connectionStatus.textContent = text;
  connectionStatus.dataset.state = state;
}

Matrix.subscribe(
  'sync',
  (state) => {
    if (
      state === 'PREPARED' ||
      state === 'SYNCING'
    ) {
      setConnectionStatus(
        state === 'PREPARED'
          ? 'Connected'
          : 'Syncing',
        'connected'
      );
    }

    if (state === 'RECONNECTING') {
      setConnectionStatus(
        'Reconnecting',
        'warning'
      );
    }

    if (state === 'ERROR') {
      setConnectionStatus(
        'Connection error',
        'error'
      );
    }

    if (state === 'STOPPED') {
      setConnectionStatus(
        'Disconnected',
        'error'
      );
    }

    renderRooms();
  }
);

Matrix.subscribe(
  'sync.error',
  (error) => {
    console.error(error);

    setConnectionStatus(
      'Connection error',
      'error'
    );
  }
);

/* ------------------------------------------------------------------
   ROOMS
------------------------------------------------------------------ */

function getRooms() {
  return Matrix
    .getRooms()
    .filter((room) => {
      const membership =
        room.getMyMembership?.();

      return (
        membership === 'join' ||
        membership === 'invite'
      );
    });
}

function getRoomPreview(room) {
  const events = Matrix.getTimeline(
    room.roomId,
    1
  );

  const event = events.at(-1);

  if (!event) {
    return 'No messages yet';
  }

  const content =
    Matrix.getMessageContent(event);

  if (content.msgtype === 'm.image') {
    return '📷 Image';
  }

  if (content.msgtype === 'm.video') {
    return '🎥 Video';
  }

  if (content.msgtype === 'm.audio') {
    return '🎵 Audio';
  }

  if (content.msgtype === 'm.file') {
    return `📎 ${content.body || 'File'}`;
  }

  return content.body || 'Encrypted message';
}

function getRoomTimestamp(room) {
  const events = Matrix.getTimeline(
    room.roomId,
    1
  );

  return events.at(-1)?.getTs?.() || 0;
}

function sortRooms(rooms) {
  return [...rooms].sort(
    (a, b) =>
      getRoomTimestamp(b) -
      getRoomTimestamp(a)
  );
}

function renderRooms() {
  const rooms = sortRooms(getRooms());

  const filtered = rooms.filter((room) => {
    if (!roomFilter) {
      return true;
    }

    return roomName(room)
      .toLowerCase()
      .includes(roomFilter.toLowerCase());
  });

  roomList.innerHTML = '';

  if (!filtered.length) {
    roomList.innerHTML = `
      <div class="room-empty">
        <span>No conversations</span>
      </div>
    `;

    return;
  }

  for (const room of filtered) {
    const element = document.createElement('button');

    element.type = 'button';
    element.className = 'room-item';

    if (room.roomId === selectedRoomId) {
      element.classList.add('active');
    }

    const avatar = getAvatarUrl(room);
    const unread =
      room.getUnreadNotificationCount?.() || 0;

    const encrypted =
      Matrix.isRoomEncrypted(room);

    element.innerHTML = `
      <span class="room-avatar">
        ${
          avatar
            ? `<img src="${escapeHtml(avatar)}" alt="">`
            : `<span>${escapeHtml(
                roomName(room).slice(0, 1).toUpperCase()
              )}</span>`
        }
      </span>

      <span class="room-copy">
        <strong>
          ${escapeHtml(roomName(room))}
        </strong>

        <span>
          ${
            encrypted
              ? '🔒 '
              : ''
          }${escapeHtml(
            getRoomPreview(room)
          )}
        </span>
      </span>

      <span class="room-meta">
        <time>
          ${getRoomTimestamp(room)
            ? escapeHtml(
                formatRelativeDate(
                  getRoomTimestamp(room)
                )
              )
            : ''}
        </time>

        ${
          unread
            ? `<b>${unread > 99 ? '99+' : unread}</b>`
            : ''
        }
      </span>
    `;

    element.addEventListener(
      'click',
      () => selectRoom(room.roomId)
    );

    roomList.appendChild(element);
  }
}

async function selectRoom(roomId) {
  const room = Matrix.getRoom(roomId);

  if (!room) {
    return;
  }

  selectedRoomId = roomId;
  lastReadEventId = null;

  roomCache.set(roomId, room);

  emptyState.classList.add('hidden');
  chatView.classList.remove('hidden');

  renderRooms();
  renderHeader();
  renderMessages();

  await Matrix.markRoomRead(roomId)
    .catch(() => {});

  requestAnimationFrame(() => {
    messageList.scrollTop =
      messageList.scrollHeight;
  });

  renderRooms();
}

function renderHeader() {
  const room =
    Matrix.getRoom(selectedRoomId);

  if (!room) {
    return;
  }

  chatName.textContent =
    roomName(room);

  const encrypted =
    Matrix.isRoomEncrypted(room);

  const memberCount =
    room.getJoinedMembers?.().length ||
    room.getMembers?.().length ||
    0;

  chatStatus.textContent =
    encrypted
      ? `🔒 End-to-end encrypted · ${memberCount} members`
      : `${memberCount} members`;

  const avatar = getAvatarUrl(room);

  if (avatar) {
    chatAvatar.src = avatar;
    chatAvatar.hidden = false;
    chatAvatarFallback.hidden = true;
  } else {
    chatAvatar.hidden = true;
    chatAvatarFallback.hidden = false;
    chatAvatarFallback.textContent =
      roomName(room).slice(0, 1).toUpperCase();
  }
}

/* ------------------------------------------------------------------
   MESSAGES
------------------------------------------------------------------ */

function renderMessages() {
  messageList.innerHTML = '';

  const room =
    Matrix.getRoom(selectedRoomId);

  if (!room) {
    return;
  }

  const events =
    Matrix.getTimeline(
      selectedRoomId,
      200
    );

  let previousDay = '';

  for (const event of events) {
    if (!Matrix.isMessageEvent(event)) {
      continue;
    }

    const timestamp =
      Matrix.getTimestamp(event);

    const day =
      new Date(timestamp).toDateString();

    if (day !== previousDay) {
      const divider =
        document.createElement('div');

      divider.className =
        'date-divider';

      divider.innerHTML = `
        <span>${escapeHtml(
          formatDay(timestamp)
        )}</span>
      `;

      messageList.appendChild(divider);

      previousDay = day;
    }

    renderMessage(
      room,
      event
    );
  }

  if (!messageList.children.length) {
    const empty =
      document.createElement('div');

    empty.className =
      'messages-empty';

    empty.innerHTML = `
      <div>◌</div>
      <p>No messages yet.</p>
      <span>Start the conversation.</span>
    `;

    messageList.appendChild(empty);
  }
}

function renderMessage(
  room,
  event
) {
  const content =
    Matrix.getMessageContent(event);

  const sender =
    Matrix.getSender(event);

  const own =
    Matrix.isOwnEvent(event);

  const element =
    document.createElement('article');

  element.className =
    `message ${own ? 'own' : ''}`;

  element.dataset.eventId =
    Matrix.getEventId(event);

  const memberName =
    getMemberName(
      room,
      sender
    );

  const avatar =
    room.getMember?.(sender)?.getMxcAvatarUrl?.();

  const relation =
    content.relatesTo;

  const edited =
    relation?.rel_type === 'm.replace';

  const isReply =
    Boolean(
      relation?.['m.in_reply_to']?.event_id
    );

  let bodyHtml = '';

  if (
    content.msgtype === 'm.image' &&
    content.url
  ) {
    const image =
      Matrix.mxcToHttp(
        content.url,
        {
          width: 1200,
          height: 1200,
          method: 'scale'
        }
      );

    bodyHtml = `
      <figure class="message-image">
        <img
          src="${escapeHtml(image)}"
          alt="${escapeHtml(content.body)}"
          loading="lazy"
        >

        ${
          content.body
            ? `<figcaption>${escapeHtml(
                content.body
              )}</figcaption>`
            : ''
        }
      </figure>
    `;
  } else if (
    content.msgtype === 'm.file' &&
    content.url
  ) {
    const fileUrl =
      Matrix.mxcToHttp(
        content.url
      );

    bodyHtml = `
      <a
        class="file-message"
        href="${escapeHtml(fileUrl)}"
        target="_blank"
        rel="noopener"
      >
        <span>📎</span>
        <span>
          <strong>
            ${escapeHtml(
              content.filename ||
              content.body ||
              'File'
            )}
          </strong>
          <small>Open attachment</small>
        </span>
      </a>
    `;
  } else {
    const text =
      content.newContent?.body ||
      content.body ||
      'Unable to display message.';

    bodyHtml = `
      <div class="message-body">
        ${linkify(text)}
      </div>
    `;
  }

  const replyEventId =
    relation?.['m.in_reply_to']?.event_id;

  let replyHtml = '';

  if (replyEventId) {
    const replied =
      Matrix.getEvent(
        selectedRoomId,
        replyEventId
      );

    if (replied) {
      const repliedContent =
        Matrix.getMessageContent(
          replied
        );

      replyHtml = `
        <button
          type="button"
          class="reply-reference"
          data-jump-to="${escapeHtml(
            replyEventId
          )}"
        >
          <strong>
            ${escapeHtml(
              getMemberName(
                room,
                Matrix.getSender(
                  replied
                )
              )
            )}
          </strong>

          <span>
            ${escapeHtml(
              repliedContent.body ||
              'Message'
            )}
          </span>
        </button>
      `;
    }
  }

  element.innerHTML = `
    ${
      !own
        ? `<div class="message-avatar">
            ${
              avatar
                ? `<img
                    src="${escapeHtml(
                      Matrix.mxcToHttp(
                        avatar,
                        {
                          width: 64,
                          height: 64,
                          method: 'crop'
                        }
                      )
                    )}"
                    alt=""
                  >`
                : escapeHtml(
                    memberName
                      .slice(0, 1)
                      .toUpperCase()
                  )
            }
          </div>`
        : ''
    }

    <div class="message-column">

      ${
        !own
          ? `<span class="message-sender">
              ${escapeHtml(memberName)}
            </span>`
          : ''
      }

      ${replyHtml}

      <div class="message-bubble">
        ${bodyHtml}

        <footer class="message-meta">
          <time>
            ${escapeHtml(
              formatTime(timestamp)
            )}
          </time>

          ${
            edited
              ? '<span>edited</span>'
              : ''
          }

          ${
            own
              ? '<span class="message-check">✓</span>'
              : ''
          }
        </footer>
      </div>

      <div class="message-actions">
        <button
          type="button"
          data-action="reply"
        >↩</button>

        <button
          type="button"
          data-action="react"
        >☺</button>

        ${
          own
            ? `<button
                type="button"
                data-action="edit"
              >✎</button>`
            : ''
        }

        ${
          own
            ? `<button
                type="button"
                data-action="delete"
              >×</button>`
            : ''
        }
      </div>
    </div>
  `;

  messageList.appendChild(element);

  element
    .querySelectorAll(
      '[data-action]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        () =>
          handleMessageAction(
            button.dataset.action,
            event
          )
      );
    });

  element
    .querySelectorAll(
      '[data-jump-to]'
    )
    .forEach((button) => {
      button.addEventListener(
        'click',
        () => jumpToEvent(
          button.dataset.jumpTo
        )
      );
    });
}

async function handleMessageAction(
  action,
  event
) {
  if (!selectedRoomId) {
    return;
  }

  if (action === 'reply') {
    setReply(event);
    return;
  }

  if (action === 'react') {
    await Matrix.sendReaction(
      selectedRoomId,
      Matrix.getEventId(event),
      '❤️'
    );

    return;
  }

  if (action === 'edit') {
    const current =
      Matrix.getMessageContent(event)
        .body || '';

    const next =
      prompt(
        'Edit message',
        current
      );

    if (
      next !== null &&
      next.trim() &&
      next.trim() !== current
    ) {
      await Matrix.editMessage(
        selectedRoomId,
        event,
        next.trim()
      );
    }

    return;
  }

  if (action === 'delete') {
    const confirmed =
      confirm(
        'Delete this message?'
      );

    if (!confirmed) {
      return;
    }

    await Matrix.redactMessage(
      selectedRoomId,
      Matrix.getEventId(event)
    );
  }
}

function jumpToEvent(eventId) {
  const target =
    messageList.querySelector(
      `[data-event-id="${CSS.escape(eventId)}"]`
    );

  target?.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
}

/* ------------------------------------------------------------------
   REPLY
------------------------------------------------------------------ */

function setReply(event) {
  replyEvent = event;

  const room =
    Matrix.getRoom(selectedRoomId);

  const content =
    Matrix.getMessageContent(event);

  replyAuthor.textContent =
    getMemberName(
      room,
      Matrix.getSender(event)
    );

  replyBody.textContent =
    content.body ||
    'Message';

  replyPreview.classList.remove(
    'hidden'
  );

  messageInput.focus();
}

function clearReply() {
  replyEvent = null;
  replyPreview.classList.add('hidden');
  replyAuthor.textContent = '';
  replyBody.textContent = '';
}

cancelReply.addEventListener(
  'click',
  clearReply
);

/* ------------------------------------------------------------------
   SENDING
------------------------------------------------------------------ */

async function sendCurrentMessage() {
  const text =
    messageInput.value.trim();

  if (!selectedRoomId || !text) {
    return;
  }

  sendButton.disabled = true;

  try {
    await Matrix.sendText(
      selectedRoomId,
      text,
      {
        replyTo: replyEvent
      }
    );

    messageInput.value = '';

    clearReply();

    resizeComposer();

    await Matrix.markRoomRead(
      selectedRoomId
    );
  } catch (error) {
    console.error(error);

    alert(
      error?.message ||
      'Message could not be sent.'
    );
  } finally {
    sendButton.disabled = false;
    messageInput.focus();
  }
}

composer.addEventListener(
  'submit',
  (event) => {
    event.preventDefault();
    sendCurrentMessage();
  }
);

messageInput.addEventListener(
  'keydown',
  (event) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      sendCurrentMessage();
    }
  }
);

function resizeComposer() {
  messageInput.style.height = 'auto';

  messageInput.style.height =
    `${Math.min(
      messageInput.scrollHeight,
      180
    )}px`;
}

messageInput.addEventListener(
  'input',
  () => {
    resizeComposer();

    if (!selectedRoomId) {
      return;
    }

    Matrix.setTyping(
      selectedRoomId,
      true,
      5000
    ).catch(() => {});

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      Matrix.setTyping(
        selectedRoomId,
        false
      ).catch(() => {});
    }, 2500);
  }
);

/* ------------------------------------------------------------------
   MEDIA
------------------------------------------------------------------ */

attachButton.addEventListener(
  'click',
  () => fileInput.click()
);

fileInput.addEventListener(
  'change',
  async () => {
    const files = [...fileInput.files];

    if (!selectedRoomId || !files.length) {
      return;
    }

    for (const file of files) {
      try {
        if (
          file.type.startsWith('image/')
        ) {
          await Matrix.sendImage(
            selectedRoomId,
            file
          );
        } else {
          const upload =
            await Matrix.uploadFile(
              file,
              {
                encrypt:
                  Matrix.isRoomEncrypted(
                    Matrix.getRoom(
                      selectedRoomId
                    )
                  )
              }
            );

          await Matrix.getClient()
            .sendMessage(
              selectedRoomId,
              {
                msgtype: 'm.file',
                body:
                  file.name ||
                  'File',
                url:
                  upload.content_uri ||
                  upload.contentUri,
                filename:
                  file.name ||
                  'File',
                info: {
                  mimetype:
                    file.type ||
                    'application/octet-stream',
                  size: file.size
                }
              }
            );
        }
      } catch (error) {
        console.error(error);

        alert(
          error?.message ||
          `Could not upload ${file.name}.`
        );
      }
    }

    fileInput.value = '';
  }
);

/* ------------------------------------------------------------------
   EMOJI
------------------------------------------------------------------ */

let activeEmojiCategory = '';

async function initializeEmoji() {
  await initUnicode();

  const metadata = getMetadata();

  console.info(
    `[Orbit] Unicode emoji loaded: ${metadata.emojiCount}`
  );

  renderEmojiCategories();

  activeEmojiCategory =
    getCategories()[0] ||
    '';

  renderEmojiGrid();
}

function renderEmojiCategories() {
  emojiCategories.innerHTML = '';

  const recentButton =
    document.createElement('button');

  recentButton.type = 'button';
  recentButton.textContent = '◷';
  recentButton.title = 'Recently used';

  recentButton.addEventListener(
    'click',
    () => {
      activeEmojiCategory = '__recent__';
      renderEmojiGrid();
    }
  );

  emojiCategories.appendChild(
    recentButton
  );

  for (const category of getCategories()) {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.textContent =
      categoryIcon(category);

    button.title = category;

    button.addEventListener(
      'click',
      () => {
        activeEmojiCategory =
          category;

        emojiSearch.value = '';

        renderEmojiGrid();
      }
    );

    emojiCategories.appendChild(
      button
    );
  }
}

function categoryIcon(category) {
  const icons = {
    'Smileys & Emotion': '☺',
    'People & Body': '◉',
    'Animals & Nature': '♧',
    'Food & Drink': '♨',
    'Travel & Places': '⌂',
    'Activities': '⚽',
    Objects: '▣',
    Symbols: '♢',
    Flags: '⚑'
  };

  return icons[category] || '•';
}

function renderEmojiGrid() {
  const query =
    emojiSearch.value.trim();

  let items;

  if (query) {
    items = searchEmoji(
      query,
      120
    );
  } else if (
    activeEmojiCategory === '__recent__'
  ) {
    items = getRecentEmoji();
  } else {
    items = getCategoryEmoji(
      activeEmojiCategory
    );
  }

  emojiGrid.innerHTML = '';

  if (!items.length) {
    emojiGrid.innerHTML = `
      <div class="emoji-empty">
        No emoji found
      </div>
    `;

    return;
  }

  for (const item of items) {
    const button =
      document.createElement('button');

    button.type = 'button';
    button.className = 'emoji-item';
    button.textContent = item.emoji;
    button.title = item.name;
    button.setAttribute(
      'aria-label',
      item.name
    );

    button.addEventListener(
      'click',
      () => {
        useEmoji(item.emoji);

        insertAtCursor(
          messageInput,
          item.emoji
        );

        emojiPicker.classList.add(
          'hidden'
        );

        emojiButton.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    );

    emojiGrid.appendChild(button);
  }
}

emojiButton.addEventListener(
  'click',
  () => {
    const hidden =
      emojiPicker.classList.toggle(
        'hidden'
      );

    emojiButton.setAttribute(
      'aria-expanded',
      String(!hidden)
    );

    if (!hidden) {
      renderEmojiGrid();
      emojiSearch.focus();
    }
  }
);

emojiSearch.addEventListener(
  'input',
  debounce(
    renderEmojiGrid,
    100
  )
);

/* ------------------------------------------------------------------
   TYPING
------------------------------------------------------------------ */

Matrix.subscribe(
  'typing',
  () => {
    if (!selectedRoomId) {
      return;
    }

    renderTyping();
  }
);

function renderTyping() {
  const room =
    Matrix.getRoom(selectedRoomId);

  if (!room) {
    typingIndicator.textContent = '';
    return;
  }

  const members =
    room.getMembers?.() || [];

  const typing = members.filter(
    (member) =>
      member.typing &&
      member.userId !== Matrix.getUserId()
  );

  if (!typing.length) {
    typingIndicator.textContent = '';
    return;
  }

  if (typing.length === 1) {
    typingIndicator.textContent =
      `${typing[0].name || typing[0].userId} is typing…`;

    return;
  }

  typingIndicator.textContent =
    `${typing.length} people are typing…`;
}

/* ------------------------------------------------------------------
   LIVE EVENTS
------------------------------------------------------------------ */

Matrix.subscribe(
  'timeline',
  () => {
    renderRooms();

    if (selectedRoomId) {
      renderHeader();
      renderMessages();
    }
  }
);

Matrix.subscribe(
  'room',
  () => {
    renderRooms();
  }
);

Matrix.subscribe(
  'membership',
  () => {
    renderRooms();
    renderHeader();
  }
);

Matrix.subscribe(
  'decrypted',
  () => {
    renderMessages();
  }
);

Matrix.subscribe(
  'redaction',
  () => {
    renderMessages();
  }
);

/* ------------------------------------------------------------------
   ROOM SEARCH
------------------------------------------------------------------ */

roomSearch.addEventListener(
  'input',
  debounce(() => {
    roomFilter =
      roomSearch.value.trim();

    renderRooms();
  }, 120)
);

/* ------------------------------------------------------------------
   NEW DM
------------------------------------------------------------------ */

$('#new-dm-btn').addEventListener(
  'click',
  () => {
    dmError.textContent = '';
    dmUser.value = '';
    dmResults.innerHTML = '';

    dmModal.showModal();
    dmUser.focus();
  }
);

$('#close-dm').addEventListener(
  'click',
  () => dmModal.close()
);

$('#cancel-dm').addEventListener(
  'click',
  () => dmModal.close()
);

const searchDirectory =
  debounce(
    async () => {
      const value =
        dmUser.value.trim();

      dmResults.innerHTML = '';

      if (!value) {
        return;
      }

      try {
        const users =
          await Matrix.searchUsers(
            value
          );

        for (const user of users) {
          const button =
            document.createElement('button');

          button.type = 'button';
          button.className =
            'directory-result';

          button.innerHTML = `
            <strong>
              ${escapeHtml(
                user.display_name ||
                user.user_id
              )}
            </strong>

            <span>
              ${escapeHtml(
                user.user_id
              )}
            </span>
          `;

          button.addEventListener(
            'click',
            () => {
              dmUser.value =
                user.user_id;

              dmResults.innerHTML = '';
            }
          );

          dmResults.appendChild(
            button
          );
        }
      } catch (error) {
        console.error(error);
      }
    },
    350
  );

dmUser.addEventListener(
  'input',
  searchDirectory
);

dmForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    dmError.textContent = '';

    const userId =
      dmUser.value.trim();

    if (!userId.startsWith('@')) {
      dmError.textContent =
        'Enter a valid Matrix user ID.';

      return;
    }

    const submit =
      $('#start-dm');

    submit.disabled = true;
    submit.textContent = 'Creating…';

    try {
      const roomId =
        await Matrix.createDM(
          userId
        );

      dmModal.close();

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 250)
      );

      renderRooms();

      await selectRoom(roomId);
    } catch (error) {
      dmError.textContent =
        error?.message ||
        'Could not create conversation.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Start';
    }
  }
);

/* ------------------------------------------------------------------
   PROFILE
------------------------------------------------------------------ */

$('#profile-btn').addEventListener(
  'click',
  async () => {
    profileError.textContent = '';

    try {
      const profile =
        await Matrix.getProfile();

      profileName.value =
        profile.displayname ||
        Matrix.getUserId();

      profileModal.showModal();
      profileName.focus();
    } catch (error) {
      profileError.textContent =
        error?.message ||
        'Could not load profile.';
    }
  }
);

$('#close-profile').addEventListener(
  'click',
  () => profileModal.close()
);

profileForm.addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    profileError.textContent = '';

    try {
      await Matrix.setDisplayName(
        profileName.value.trim()
      );

      sidebarUser.textContent =
        profileName.value.trim() ||
        Matrix.getUserId();

      profileModal.close();
    } catch (error) {
      profileError.textContent =
        error?.message ||
        'Could not update profile.';
    }
  }
);

$('#logout-btn').addEventListener(
  'click',
  async () => {
    const confirmed =
      confirm(
        'Sign out of Orbit on this device?'
      );

    if (!confirmed) {
      return;
    }

    try {
      await Matrix.logout();
    } finally {
      window.location.replace(
        './index.html'
      );
    }
  }
);

/* ------------------------------------------------------------------
   MOBILE
------------------------------------------------------------------ */

$('#back-btn').addEventListener(
  'click',
  () => {
    document.body.classList.remove(
      'mobile-chat-open'
    );
  }
);

/* ------------------------------------------------------------------
   INIT
------------------------------------------------------------------ */

async function init() {
  applyTheme();

  try {
    const session =
      Matrix.getSession();

    sidebarUser.textContent =
      session.userId;

    setConnectionStatus(
      'Initializing',
      'warning'
    );

    await Matrix.start();

    renderRooms();

    await initializeEmoji();

    setConnectionStatus(
      'Connected',
      'connected'
    );
  } catch (error) {
    console.error(
      '[Orbit] initialization failed',
      error
    );

    setConnectionStatus(
      'Unavailable',
      'error'
    );

    alert(
      error?.message ||
      'Orbit could not connect to Matrix.'
    );

    window.location.replace(
      './index.html'
    );
  }
}

window.addEventListener(
  'beforeunload',
  () => {
    Matrix.stop().catch(() => {});
  }
);

init();