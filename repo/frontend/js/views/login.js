import { login, register, validatePassword } from '../services/auth-service.js';
import { showNotification } from '../components/notifications.js';

export function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-container">
      <div class="auth-card">
        <h1 class="auth-title">HarborGate</h1>
        <p class="auth-subtitle">Visitor Access & Content Compliance</p>

        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">Sign In</button>
          <button class="auth-tab" data-tab="register">Register</button>
        </div>

        <form id="login-form" class="auth-form">
          <label class="form-label">Username
            <input type="text" name="username" class="input" required autocomplete="username" />
          </label>
          <label class="form-label">Password
            <input type="password" name="password" class="input" required autocomplete="current-password" />
          </label>
          <div id="login-error" class="auth-error"></div>
          <button type="submit" class="btn btn-primary btn-block">Sign In</button>
        </form>

        <form id="register-form" class="auth-form" style="display:none">
          <label class="form-label">Username
            <input type="text" name="username" class="input" required autocomplete="username" />
          </label>
          <label class="form-label">Password
            <input type="password" name="password" class="input" required autocomplete="new-password" />
          </label>
          <label class="form-label">Confirm Password
            <input type="password" name="confirmPassword" class="input" required />
          </label>
          <input type="hidden" name="role" value="visitor" />
          <div id="password-requirements" class="password-requirements">
            <p>Password must have:</p>
            <ul>
              <li id="req-length">Min 12 characters</li>
              <li id="req-upper">1 uppercase letter</li>
              <li id="req-lower">1 lowercase letter</li>
              <li id="req-number">1 number</li>
              <li id="req-symbol">1 symbol</li>
            </ul>
          </div>
          <div id="register-error" class="auth-error"></div>
          <button type="submit" class="btn btn-primary btn-block">Register</button>
        </form>
      </div>
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      container.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('login-form').style.display = tab.dataset.tab === 'login' ? '' : 'none';
      document.getElementById('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
    });
  });

  // Password validation feedback
  const regPwInput = container.querySelector('#register-form [name="password"]');
  if (regPwInput) {
    regPwInput.addEventListener('input', (e) => {
      const pw = e.target.value;
      document.getElementById('req-length').className = pw.length >= 12 ? 'met' : '';
      document.getElementById('req-upper').className = /[A-Z]/.test(pw) ? 'met' : '';
      document.getElementById('req-lower').className = /[a-z]/.test(pw) ? 'met' : '';
      document.getElementById('req-number').className = /[0-9]/.test(pw) ? 'met' : '';
      document.getElementById('req-symbol').className = /[^A-Za-z0-9]/.test(pw) ? 'met' : '';
    });
  }

  // Login handler
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = fd.get('username');
    const password = fd.get('password');
    const errorEl = document.getElementById('login-error');

    const result = await login(username, password);
    if (result.success) {
      showNotification('Welcome back, ' + username, 'success');
      window.location.hash = '/';
    } else {
      errorEl.textContent = result.error;
      if (result.attemptsLeft !== undefined) {
        errorEl.textContent += ` (${result.attemptsLeft} attempts remaining)`;
      }
    }
  });

  // Register handler
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = fd.get('username');
    const password = fd.get('password');
    const confirmPassword = fd.get('confirmPassword');
    const role = fd.get('role');
    const errorEl = document.getElementById('register-error');

    if (password !== confirmPassword) {
      errorEl.textContent = 'Passwords do not match';
      return;
    }

    const validation = validatePassword(password);
    if (!validation.valid) {
      errorEl.textContent = validation.errors.join(', ');
      return;
    }

    const result = await register(username, password, role);
    if (result.success) {
      showNotification('Account created! Please sign in.', 'success');
      container.querySelector('[data-tab="login"]').click();
    } else {
      errorEl.textContent = result.errors.join(', ');
    }
  });
}
