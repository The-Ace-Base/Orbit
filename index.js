const SESSION_KEY = 'orbit.session';
const HOMESERVER_KEY = 'orbit-homeserver';
const THEME_KEY = 'orbit-theme';

const $ = (selector) => document.querySelector(selector);

const form = $('#login-form');
const homeserverSelect = $('#homeserver-select');
const customHomeserverField = $('#custom-homeserver-field');
const customHomeserver = $('#homeserver-custom');
const usernameInput = $('#login-user');
const passwordInput = $('#login-password');
const rememberHomeserver = $('#remember-homeserver');
const loginButton = $('#login-button');
const loginError = $('#login-error');

function normalizeHomeserver(value) {
  const input = String(value || '').trim();

  if (!input) {
    return '';
  }

  try {
    const url = new URL(
      input.includes('://') ? input : `https://${input}`
    );

    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }

    if (url.username || url.password || url.search || url.hash) {
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
    return normalizeHomeserver(customHomeserver.value);
  }

  return normalizeHomeserver(homeserverSelect.value);
}

function showError(message) {
  loginError.textContent = message || '';
}

function setLoading(loading) {
  loginButton.disabled = loading;
  loginButton.querySelector('span').textContent =
    loading ? 'Connecting…' : 'Enter Orbit';
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function applyTheme() {
  const theme = localStorage.getItem(THEME_KEY);

  if (theme === 'light' || theme === 'dark') {
    document.documentElement.dataset.theme = theme;
  }
}

function updateCustomHomeserver() {
  const visible = homeserverSelect.value === 'custom';

  customHomeserverField.classList.toggle('hidden', !visible);
  customHomeserver.required = visible;

  if (visible) {
    customHomeserver.focus();
  }
}

function restoreHomeserver() {
  const saved = localStorage.getItem(HOMESERVER_KEY);

  if (!saved) {
    return;
  }

  const matchingOption = [...homeserverSelect.options]
    .find((option) => option.value === saved);

  if (matchingOption) {
    homeserverSelect.value = saved;
  } else {
    homeserverSelect.value = 'custom';
    customHomeserver.value = saved;
    customHomeserverField.classList.remove('hidden');
  }

  rememberHomeserver.checked = true;
}

async function login() {
  showError('');

  const homeserver = getHomeserver();
  const user = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!homeserver) {
    showError('Enter a valid homeserver URL.');
    return;
  }

  if (!user) {
    showError('Enter your Matrix username.');
    usernameInput.focus();
    return;
  }

  if (!password) {
    showError('Enter your password.');
    passwordInput.focus();
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
          password,
          initial_device_display_name: 'Orbit'
        })
      }
    );

    let data = null;

    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        `Login failed (${response.status}).`
      );
    }

    if (
      !data?.access_token ||
      !data?.user_id ||
      !data?.device_id
    ) {
      throw new Error('The homeserver returned an incomplete login response.');
    }

    const session = {
      homeserver,
      accessToken: data.access_token,
      userId: data.user_id,
      deviceId: data.device_id,
      expiresInMs: data.expires_in_ms || null,
      refreshToken: data.refresh_token || null,
      createdAt: Date.now()
    };

    saveSession(session);

    if (rememberHomeserver.checked) {
      localStorage.setItem(HOMESERVER_KEY, homeserver);
    } else {
      localStorage.removeItem(HOMESERVER_KEY);
    }

    window.location.replace('./chat.html');
  } catch (error) {
    showError(error?.message || 'Unable to sign in.');
  } finally {
    setLoading(false);
  }
}

homeserverSelect.addEventListener(
  'change',
  updateCustomHomeserver
);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  login();
});

applyTheme();
restoreHomeserver();
updateCustomHomeserver();