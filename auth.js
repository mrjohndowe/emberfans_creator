const form = document.querySelector('#authForm');
const message = document.querySelector('#authMessage');
const switchMode = document.querySelector('#switchMode');
let isLogin = false;

function setMode(login) {
  isLogin = login;
  document.querySelector('#formTitle').textContent = login ? 'Welcome back' : 'Create your account';
  document.querySelector('#formSubtitle').textContent = login ? 'Sign in to your EmberFans account.' : 'Join verified creator communities. You must be 18 or older.';
  document.querySelector('#submitButton').innerHTML = login ? 'Sign in <span>&#8594;</span>' : 'Create account <span>&#8594;</span>';
  document.querySelector('#switchPrompt').textContent = login ? 'New to EmberFans?' : 'Already have an account?';
  switchMode.textContent = login ? 'Create an account' : 'Sign in';
  document.querySelectorAll('.signup-only').forEach(item => item.hidden = login);
  document.querySelector('#displayName').required = !login;
  document.querySelector('#password').autocomplete = login ? 'current-password' : 'new-password';
  message.textContent = '';
}

switchMode.addEventListener('click', () => setMode(!isLogin));
form.addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  const body = { email: document.querySelector('#email').value, password: document.querySelector('#password').value };
  if (!isLogin) Object.assign(body, { displayName: document.querySelector('#displayName').value, confirmAdult: document.querySelector('#confirmAdult').checked, acceptTerms: document.querySelector('#acceptTerms').checked });
  const response = await fetch(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) { message.textContent = result.error || 'Please try again.'; return; }
  sessionStorage.setItem('emberfansToken', result.token);
  sessionStorage.setItem('emberfansUser', JSON.stringify(result.user));
  window.location.assign('index.html');
});
