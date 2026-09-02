const DEFAULT_UNICODE_URL =
  'https://www.unicode.org/Public/emoji/latest/emoji-test.txt';

const CACHE_KEY = 'orbit.unicode.emoji';
const CACHE_VERSION = 'unicode-emoji-latest';

const SKIN_TONES = [
  '🏻',
  '🏼',
  '🏽',
  '🏾',
  '🏿'
];

const CATEGORY_ORDER = [
  'Smileys & Emotion',
  'People & Body',
  'Animals & Nature',
  'Food & Drink',
  'Travel & Places',
  'Activities',
  'Objects',
  'Symbols',
  'Flags'
];

const FALLBACK_EMOJI = [
  ['😀', 'grinning face', 'Smileys & Emotion'],
  ['😃', 'grinning face with big eyes', 'Smileys & Emotion'],
  ['😄', 'grinning face with smiling eyes', 'Smileys & Emotion'],
  ['😁', 'beaming face with smiling eyes', 'Smileys & Emotion'],
  ['😂', 'face with tears of joy', 'Smileys & Emotion'],
  ['🤣', 'rolling on the floor laughing', 'Smileys & Emotion'],
  ['😊', 'smiling face with smiling eyes', 'Smileys & Emotion'],
  ['🙂', 'slightly smiling face', 'Smileys & Emotion'],
  ['🙃', 'upside-down face', 'Smileys & Emotion'],
  ['😉', 'winking face', 'Smileys & Emotion'],
  ['😍', 'smiling face with heart-eyes', 'Smileys & Emotion'],
  ['🥰', 'smiling face with hearts', 'Smileys & Emotion'],
  ['😘', 'face blowing a kiss', 'Smileys & Emotion'],
  ['😎', 'smiling face with sunglasses', 'Smileys & Emotion'],
  ['🤔', 'thinking face', 'Smileys & Emotion'],
  ['😭', 'loudly crying face', 'Smileys & Emotion'],
  ['😡', 'enraged face', 'Smileys & Emotion'],
  ['❤️', 'red heart', 'Smileys & Emotion'],
  ['🔥', 'fire', 'Travel & Places'],
  ['✨', 'sparkles', 'Activities'],
  ['⭐', 'star', 'Travel & Places'],
  ['🎉', 'party popper', 'Activities'],
  ['👍', 'thumbs up', 'People & Body'],
  ['👎', 'thumbs down', 'People & Body'],
  ['👏', 'clapping hands', 'People & Body'],
  ['🙏', 'folded hands', 'People & Body'],
  ['💯', 'hundred points', 'Smileys & Emotion'],
  ['🚀', 'rocket', 'Travel & Places'],
  ['💻', 'laptop', 'Objects'],
  ['🎵', 'musical note', 'Activities'],
  ['☕', 'hot beverage', 'Food & Drink']
];

let emoji = [];
let categories = [];
let initialized = false;
let initializing = null;

const recentlyUsed = loadRecent();

function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadRecent() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem('orbit.emoji.recent') || '[]'
    );

    return Array.isArray(parsed)
      ? parsed.filter(Boolean).slice(0, 48)
      : [];
  } catch {
    return [];
  }
}

function saveRecent() {
  localStorage.setItem(
    'orbit.emoji.recent',
    JSON.stringify(recentlyUsed.slice(0, 48))
  );
}

function rememberEmoji(value) {
  const index = recentlyUsed.indexOf(value);

  if (index !== -1) {
    recentlyUsed.splice(index, 1);
  }

  recentlyUsed.unshift(value);

  recentlyUsed.splice(48);

  saveRecent();
}

function parseCodepoints(value) {
  return value
    .trim()
    .split(/\s+/)
    .map((hex) => parseInt(hex, 16))
    .filter(Number.isFinite);
}

function codepointsToString(codepoints) {
  return String.fromCodePoint(...codepoints);
}

function mapGroup(group) {
  const normalized = normalizeName(group);

  if (normalized.includes('smileys')) {
    return 'Smileys & Emotion';
  }

  if (normalized.includes('people') || normalized.includes('body')) {
    return 'People & Body';
  }

  if (normalized.includes('animals') || normalized.includes('nature')) {
    return 'Animals & Nature';
  }

  if (normalized.includes('food') || normalized.includes('drink')) {
    return 'Food & Drink';
  }

  if (
    normalized.includes('travel') ||
    normalized.includes('places')
  ) {
    return 'Travel & Places';
  }

  if (normalized.includes('activities')) {
    return 'Activities';
  }

  if (normalized.includes('objects')) {
    return 'Objects';
  }

  if (normalized.includes('symbols')) {
    return 'Symbols';
  }

  if (normalized.includes('flags')) {
    return 'Flags';
  }

  return group || 'Other';
}

function parseEmojiTest(text) {
  const result = [];

  let currentGroup = 'Other';
  let currentSubgroup = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith('# group:')) {
      currentGroup = mapGroup(
        line.slice('# group:'.length).trim()
      );

      continue;
    }

    if (line.startsWith('# subgroup:')) {
      currentSubgroup =
        line.slice('# subgroup:'.length).trim();

      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const match = line.match(
      /^([0-9A-F ]+)\s*;\s*([a-z-]+)\s*#\s*(\S+)\s+(.+)$/
    );

    if (!match) {
      continue;
    }

    const [
      ,
      codepointString,
      status,
      character,
      name
    ] = match;

    if (
      status !== 'fully-qualified' &&
      status !== 'component'
    ) {
      continue;
    }

    if (status === 'component') {
      continue;
    }

    result.push({
      emoji: character,
      name,
      normalizedName: normalizeName(name),
      category: currentGroup,
      subgroup: currentSubgroup,
      codepoints: parseCodepoints(codepointString),
      skinTone: SKIN_TONES.some((tone) =>
        character.includes(tone)
      ),
      zwj: character.includes('\u200D'),
      flag:
        currentGroup === 'Flags' ||
        character.includes('\u{1F1E6}'),
      keycap: character.includes('\u20E3'),
      version: 'latest'
    });
  }

  return result;
}

function buildFallback() {
  return FALLBACK_EMOJI.map(
    ([character, name, category]) => ({
      emoji: character,
      name,
      normalizedName: normalizeName(name),
      category,
      subgroup: '',
      codepoints: [...character].map((char) =>
        char.codePointAt(0)
      ),
      skinTone: false,
      zwj: character.includes('\u200D'),
      flag: category === 'Flags',
      keycap: character.includes('\u20E3'),
      version: 'fallback'
    })
  );
}

async function fetchEmojiData(url) {
  const response = await fetch(url, {
    cache: 'force-cache'
  });

  if (!response.ok) {
    throw new Error(
      `Unicode data request failed: ${response.status}`
    );
  }

  return response.text();
}

function rebuildCategories() {
  const available = new Set(
    emoji.map((item) => item.category)
  );

  categories = [
    ...CATEGORY_ORDER.filter((category) =>
      available.has(category)
    ),
    ...[...available]
      .filter(
        (category) => !CATEGORY_ORDER.includes(category)
      )
      .sort()
  ];
}

export async function init({
  url = DEFAULT_UNICODE_URL,
  forceRefresh = false
} = {}) {
  if (initialized && !forceRefresh) {
    return emoji;
  }

  if (initializing && !forceRefresh) {
    return initializing;
  }

  initializing = (async () => {
    try {
      if (!forceRefresh) {
        const cached = localStorage.getItem(CACHE_KEY);

        if (cached) {
          const parsed = JSON.parse(cached);

          if (
            parsed?.version === CACHE_VERSION &&
            Array.isArray(parsed.items)
          ) {
            emoji = parsed.items;
            rebuildCategories();
            initialized = true;

            return emoji;
          }
        }
      }

      const text = await fetchEmojiData(url);

      emoji = parseEmojiTest(text);

      if (!emoji.length) {
        throw new Error('Unicode dataset was empty.');
      }

      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({
          version: CACHE_VERSION,
          fetchedAt: Date.now(),
          items: emoji
        })
      );

      rebuildCategories();
      initialized = true;

      return emoji;
    } catch (error) {
      console.warn(
        '[Orbit] Unicode data unavailable. Using fallback.',
        error
      );

      emoji = buildFallback();
      rebuildCategories();
      initialized = true;

      return emoji;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

export function getEmoji() {
  return emoji;
}

export function getCategories() {
  return [...categories];
}

export function getRecentEmoji() {
  return recentlyUsed
    .map((value) =>
      emoji.find((item) => item.emoji === value)
    )
    .filter(Boolean);
}

export function useEmoji(value) {
  rememberEmoji(value);
}

export function searchEmoji(query, limit = 80) {
  const term = normalizeName(query);

  if (!term) {
    return emoji.slice(0, limit);
  }

  const words = term.split(' ');

  return emoji
    .map((item) => {
      let score = 0;

      if (item.normalizedName === term) {
        score += 100;
      }

      if (
        item.normalizedName.startsWith(term)
      ) {
        score += 50;
      }

      if (
        item.normalizedName.includes(term)
      ) {
        score += 20;
      }

      for (const word of words) {
        if (item.normalizedName.includes(word)) {
          score += 5;
        }
      }

      return {
        item,
        score
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.item.name.localeCompare(b.item.name)
    )
    .slice(0, limit)
    .map(({ item }) => item);
}

export function getCategoryEmoji(
  category,
  limit = Infinity
) {
  return emoji
    .filter((item) => item.category === category)
    .slice(0, limit);
}

export function getSkinToneVariants(
  baseEmoji
) {
  return emoji.filter((item) => {
    if (!item.skinTone) {
      return false;
    }

    return (
      item.name === baseEmoji.name ||
      item.normalizedName.includes(
        baseEmoji.normalizedName
      )
    );
  });
}

export function getEmojiByCharacter(character) {
  return emoji.find(
    (item) => item.emoji === character
  ) || null;
}

export function insertAtCursor(
  input,
  value
) {
  const start =
    input.selectionStart ?? input.value.length;

  const end =
    input.selectionEnd ?? input.value.length;

  const before = input.value.slice(0, start);
  const after = input.value.slice(end);

  input.value =
    `${before}${value}${after}`;

  const position =
    start + value.length;

  input.setSelectionRange(
    position,
    position
  );

  input.dispatchEvent(
    new Event('input', {
      bubbles: true
    })
  );

  input.focus();
}

export function getMetadata() {
  return {
    source: DEFAULT_UNICODE_URL,
    version: 'latest',
    emojiCount: emoji.length,
    categories: categories.length
  };
}

export {
  emoji,
  categories,
  SKIN_TONES
};