const token = sessionStorage.getItem('emberfansToken');
const message = document.querySelector('#studioMessage');
const studio = document.querySelector('#studioCard');
let currentUser;

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed.');
  return body;
}

async function start() {
  if (!token) { window.location.assign('auth.html'); return; }
  try {
    const result = await request('/api/me');
    currentUser = result.user;
    document.querySelector('#accountStatus').textContent = `${currentUser.displayName} - ${currentUser.role}`;
    if (!['performer', 'admin'].includes(currentUser.role)) {
      document.querySelector('#accountStatus').textContent = 'This account needs performer approval before it can publish.';
      return;
    }
    studio.hidden = false;
  } catch {
    sessionStorage.removeItem('emberfansToken');
    window.location.assign('auth.html');
  }
}

document.querySelector('#publishForm').addEventListener('submit', async event => {
  event.preventDefault();
  message.textContent = '';
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const item = await request('/api/content', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: document.querySelector('#title').value, summary: document.querySelector('#summary').value, kind: document.querySelector('#kind').value, accessType: document.querySelector('#accessType').value }) });
    const media = document.querySelector('#media').files[0];
    if (media) {
      const upload = new FormData();
      upload.append('media', media);
      await request(`/api/content/${item.item.id}/media`, { method: 'POST', body: upload });
    }
    event.currentTarget.reset();
    message.style.color = '#9be19b';
    message.textContent = 'Published. Your content is now available to entitled viewers.';
  } catch (error) {
    message.style.color = '#ffaaa2';
    message.textContent = error.message;
  } finally { button.disabled = false; }
});

start();
