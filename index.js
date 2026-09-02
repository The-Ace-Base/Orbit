const SESSION_KEY = 'orbit.session';
const HOMESERVER_KEY = 'orbit.homeserver';
const THEME_KEY = 'orbit-theme';

const form = document.querySelector('#login-form');
const homeserverSelect = document.querySelector('#homeserver-select');
const customHomeserverField = document.querySelector('#custom-homeserver-field');
const customHomeserverInput = document.querySelector('#homeserver-custom');

const userInput = document.querySelector('#login-user');
const passwordInput = document.querySelector('#login-password');

const rememberHomeserver = document.querySelector('#remember-homeserver');
const loginButton = document.querySelector('#login-button');
const loginError = document.querySelector('#login-error');

const themeButton = document.querySelector('#auth-theme-toggle');

function normalizeHomeserver(value) {
  const input = String(value || '').trim();

  if (!input) return '';

  try {
    const url = new URL(
      input.includes('://')
        ? input
        : `https://${input}`
    );

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return '';
    }

    url.pathname = url.pathname.replace(/\/+$/, '');

    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function getHomeserver() {
  if (homeserverSelect.value === 'custom') {
    return normalizeHomeserver(customHomeserverInput.value);
  }

  return normalizeHomeserver(homeserverSelect.value);
}

function setLoading(loading) {
  loginButton.disabled = loading;

  loginButton.innerHTML = loading
    ? `
      <span class="button-spinner"></span>
      Connecting
    `
    : `
      <span>Enter Orbit</span>
      <i class="hgi-stroke hgi-arrow-up-right-01"></i>
    `;
}

function showError(message = '') {
  loginError.textContent = message;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  localStorage.setItem(THEME_KEY, theme);

  const icon = themeButton?.querySelector('i');

  if (icon) {
    icon.className =
      theme === 'dark'
        ? 'hgi-stroke hgi-sun-03'
        : 'hgi-stroke hgi-moon-02';
  }
}

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);

  if (saved === 'dark' || saved === 'light') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function saveSession(data) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(data)
  );
}

async function login() {
  showError('');

  const homeserver = getHomeserver();
  const user = userInput.value.trim();
  const password = passwordInput.value;

  if (!homeserver) {
    showError('Enter a valid homeserver URL.');
    return;
  }

  if (!user) {
    showError('Enter your Matrix ID.');
    return;
  }

  if (!password) {
    showError('Enter your password.');
    return;
  }

  setLoading(true);

  try {
    const response = await fetch(
      `${homeserver}/_matrix/client/v3/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'm.login.password',
          identifier: {
            type: 'm.id.user',
            user
          },
          password
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error ||
        data.errcode ||
        `Login failed (${response.status})`
      );
    }

    if (!data.access_token || !data.user_id) {
      throw new Error(
        'The homeserver returned an incomplete login response.'
      );
    }

    const session = {
      homeserver,
      userId: data.user_id,
      accessToken: data.access_token,
      deviceId: data.device_id || null,
      expiresInMs: data.expires_in_ms || null,
      createdAt: Date.now()
    };

    saveSession(session);

    if (rememberHomeserver.checked) {
      localStorage.setItem(
        HOMESERVER_KEY,
        homeserver
      );
    } else {
      localStorage.removeItem(HOMESERVER_KEY);
    }

    window.location.replace('./chat.html');
  } catch (error) {
    showError(
      error?.message ||
      'Unable to connect to this homeserver.'
    );

    setLoading(false);
  }
}

homeserverSelect.addEventListener('change', () => {
  const custom =
    homeserverSelect.value === 'custom';

  customHomeserverField.classList.toggle(
    'hidden',
    !custom
  );

  if (custom) {
    customHomeserverInput.focus();
  }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  login();
});

themeButton?.addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme;

  applyTheme(
    current === 'dark'
      ? 'light'
      : 'dark'
  );
});

const rememberedHomeserver =
  localStorage.getItem(HOMESERVER_KEY);

if (rememberedHomeserver) {
  const known =
    [...homeserverSelect.options]
      .find(option =>
        option.value === rememberedHomeserver
      );

  if (known) {
    homeserverSelect.value =
      rememberedHomeserver;
  } else {
    homeserverSelect.value = 'custom';
    customHomeserverField.classList.remove('hidden');
    customHomeserverInput.value =
      rememberedHomeserver;
  }

  rememberHomeserver.checked = true;
}

applyTheme(getInitialTheme());