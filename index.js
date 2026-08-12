// index.js – login and session management

const loginForm = document.querySelector('#login-form');
const loginButton = document.querySelector('#login-button');
const loginError = document.querySelector('#login-error');
const homeserverInput = document.querySelector('#login-homeserver');
const userInput = document.querySelector('#login-user');
const passwordInput = document.querySelector('#login-password');

const THEME_KEY = 'orbit-theme';

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

// Session storage helpers
const SESSION_KEY = 'orbit.session';
function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.homeserver || !s.userId || !s.accessToken) return null;
    return s;
  } catch { return null; }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function showError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove('hidden');
}
function clearError() {
  loginError.textContent = '';
  loginError.classList.add('hidden');
}

// Check for existing session on load
const existing = loadSession();
if (existing) {
  window.location.href = './chat.html';
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const homeserver = homeserverInput.value.trim().replace(/\/+$/, '');
  const userId = userInput.value.trim();
  const password = passwordInput.value;

  if (!homeserver || !userId || !password) {
    showError('All fields are required.');
    return;
  }

  loginButton.disabled = true;
  loginButton.textContent = 'Signing in…';

  try {
    // REST login
    const loginRes = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: userId },
        password,
        initial_device_display_name: 'Orbit Web',
      }),
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
      throw new Error(loginData.error || 'Login failed');
    }

    const session = {
      homeserver,
      userId: loginData.user_id,
      accessToken: loginData.access_token,
      deviceId: loginData.device_id,
    };

    // Fetch profile
    const profileRes = await fetch(
      `${homeserver}/_matrix/client/v3/profile/${encodeURIComponent(session.userId)}`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } }
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      session.displayName = profile.displayname || null;
      session.avatarUrl = profile.avatar_url || null;
    }

    saveSession(session);
    window.location.href = './chat.html';
  } catch (err) {
    console.error(err);
    showError(err.message || 'Login failed. Check credentials and server.');
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Sign in';
  }
});