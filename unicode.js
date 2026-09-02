const EMOJI_URL =
  'https://www.unicode.org/Public/emoji/latest/emoji-test.txt';

const CACHE_KEY = 'orbit.unicode.emoji';
const RECENT_KEY = 'orbit.emoji.recent';

const TONES = [
  '',
  '🏻',
  '🏼',
  '🏽',
  '🏾',
  '🏿'
];

const GROUP_ICONS = {
  'Smileys & Emotion': '☺',
  'People & Body': '♙',
  'Animals & Nature': '♧',
  'Food & Drink': '♨',
  'Travel & Places': '⌖',
  'Activities': '✦',
  'Objects': '◇',
  'Symbols': '◎',
  'Flags': '⚑'
};

let emojiData = [];
let loaded = false;

function parseEmojiTest(text) {
  const result = [];

  let group = 'Other';
  let subgroup = 'Other';

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (trimmed.startsWith('# group:')) {
      group = trimmed
        .replace('# group:', '')
        .trim();

      continue;
    }

    if (trimmed.startsWith('# subgroup:')) {
      subgroup = trimmed
        .replace('# subgroup:', '')
        .trim();

      continue;
    }

    if (trimmed.startsWith('#')) continue;

    const match = trimmed.match(
      /^([0-9A-F ]+)\s*;\s*([a-z-]+)\s*#\s*(\S+)\s+E\d+\.\d+\s+(.+)$/
    );

    if (!match) continue;

    const [
      ,
      codepoints,
      status,
      emoji,
      name
    ] = match;

    if (status !== 'fully-qualified') {
      continue;
    }

    result.push({
      emoji,
      name,
      group,
      subgroup,
      codepoints
    });
  }

  return result;
}

function saveCache(data) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify(data)
    );
  } catch {
    // Storage is optional.
  }
}

function loadCache() {
  try {
    const raw =
      localStorage.getItem(CACHE_KEY);

    return raw
      ? JSON.parse(raw)
      : null;
  } catch {
    return null;
  }
}

export async function loadEmoji() {
  if (loaded) return emojiData;

  const cached = loadCache();

  if (Array.isArray(cached) && cached.length) {
    emojiData = cached;
    loaded = true;

    refreshEmojiData().catch(() => {});

    return emojiData;
  }

  return refreshEmojiData();
}

async function refreshEmojiData() {
  const response = await fetch(
    EMOJI_URL,
    {
      cache: 'force-cache'
    }
  );

  if (!response.ok) {
    throw new Error(
      `Unicode emoji data failed: ${response.status}`
    );
  }

  const text = await response.text();

  const parsed = parseEmojiTest(text);

  if (!parsed.length) {
    throw new Error(
      'Unicode returned no emoji.'
    );
  }

  emojiData = parsed;

  loaded = true;

  saveCache(parsed);

  return emojiData;
}

export function getGroups() {
  const groups = [];

  for (const item of emojiData) {
    if (!groups.includes(item.group)) {
      groups.push(item.group);
    }
  }

  return groups;
}

export function getGroupIcon(group) {
  return GROUP_ICONS[group] || '•';
}

export function searchEmoji(query, group = '') {
  const term = String(query || '')
    .trim()
    .toLowerCase();

  return emojiData.filter(item => {
    if (
      group &&
      item.group !== group
    ) {
      return false;
    }

    if (!term) return true;

    return (
      item.name
        .toLowerCase()
        .includes(term) ||
      item.subgroup
        .toLowerCase()
        .includes(term)
    );
  });
}

export function getRecentEmoji() {
  try {
    const ids =
      JSON.parse(
        localStorage.getItem(RECENT_KEY) || '[]'
      );

    return ids
      .map(id =>
        emojiData.find(
          item => item.emoji === id
        )
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji) {
  try {
    const existing =
      JSON.parse(
        localStorage.getItem(RECENT_KEY) || '[]'
      );

    const next = [
      emoji,
      ...existing.filter(
        item => item !== emoji
      )
    ].slice(0, 48);

    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(next)
    );
  } catch {
    // Optional.
  }
}

export function createToneVariants(emoji) {
  const variants = [];

  for (const tone of TONES.slice(1)) {
    const variant =
      emoji.replace(
        /[🏻🏼🏽🏾🏿]/u,
        tone
      );

    if (variant !== emoji) {
      variants.push(variant);
    }
  }

  if (!variants.length) {
    const index = emoji.search(
      /[\u{1F466}-\u{1F487}\u{1F469}\u{1F474}-\u{1F476}\u{1F9D1}]/u
    );

    if (index !== -1) {
      const first =
        [...emoji][index];

      for (const tone of TONES.slice(1)) {
        variants.push(
          emoji.replace(
            first,
            `${first}${tone}`
          )
        );
      }
    }
  }

  return variants;
}

export function getTone(index) {
  return TONES[index] || '';
}