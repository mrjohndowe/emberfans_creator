const token = sessionStorage.getItem('emberfansToken');
const list = document.querySelector('#communityList');
const channels = document.querySelector('#channelList');
const messages = document.querySelector('#messageList');
const form = document.querySelector('#messageForm');
let user, community, channel, sidebar, suppressChannelClickUntil = 0;
let voiceTestStream = null;

const icons = { text: '#', forum: '[]', voice: '🔊', auditorium: '🎙' };
const titles = { text: 'TEXT CHANNEL', forum: 'FORUM CHANNEL', voice: 'VOICE CHANNEL', auditorium: 'AUDITORIUM' };

const menu = document.createElement('div');
menu.style.cssText = 'display:none;position:fixed;z-index:20;min-width:190px;padding:7px;background:#26272f;border:1px solid #3b3d49;border-radius:7px;box-shadow:0 12px 35px #0008';
document.body.append(menu);
document.addEventListener('click', () => menu.style.display = 'none');

const channelModal = document.createElement('div');
channelModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:30;place-items:center;background:#08090dbb';
channelModal.innerHTML = '<form style="width:min(380px,calc(100% - 30px));padding:24px;background:#20212a;border:1px solid #40424e;border-radius:10px;display:grid;gap:14px"><strong id="channelModalTitle" style="font-size:18px">Create Channel</strong><label style="display:grid;gap:6px;font-size:11px">Channel name<input id="channelModalName" maxlength="48" required style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"></label><label style="display:grid;gap:6px;font-size:11px">Channel type<select id="channelModalType" style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"><option value="text">Text channel</option><option value="forum">Forum channel</option><option value="voice">Voice channel</option><option value="auditorium">Auditorium</option></select></label><div style="display:flex;justify-content:end;gap:8px"><button type="button" id="channelModalCancel" class="secondary-button">Cancel</button><button class="primary-button">Create channel</button></div></form>';
document.body.append(channelModal);

const settingsModal = document.createElement('div');
settingsModal.className = 'settings-modal';
settingsModal.innerHTML = '<section class="settings-card"><nav class="settings-nav"><strong>Administration</strong><button class="active" data-settings-view="overview">Overview</button><button data-settings-view="audit">Audit Log</button><button data-settings-view="roles">Roles & Permissions</button><button data-settings-view="moderation">Moderation</button><button data-settings-view="integrations">Integrations</button></nav><main class="settings-main"><button class="settings-close" aria-label="Close administration settings">×</button><div id="settingsContent"></div></main></section>';
document.body.append(settingsModal);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = response.status === 204 ? {} : isJson ? await response.json() : {};
  if (!isJson && response.status !== 204) {
    throw Error('The server returned an unexpected response. Restart the EmberFans server, refresh this page, and try again.');
  }
  if (!response.ok) throw Error(body.error || 'Request failed.');
  return body;
}

function esc(value) {
  const node = document.createElement('i');
  node.textContent = value;
  return node.innerHTML;
}

function canEdit() {
  return user && (['owner', 'moderator'].includes(community?.member_role) || user.role === 'admin');
}

function auditDescription(entry) {
  const details = entry.details || {};
  if (entry.action === 'channel_created') return `Created #${details.name || 'channel'} (${details.type || 'channel'}).`;
  if (entry.action === 'channel_deleted') return `Deleted #${details.name || 'channel'} (${details.type || 'channel'}).`;
  if (entry.action === 'category_created') return `Created the ${details.name || 'unnamed'} category.`;
  if (entry.action === 'category_deleted') return `Deleted the ${details.name || 'unnamed'} category and moved ${details.movedChannelCount || 0} channel${details.movedChannelCount === 1 ? '' : 's'} to ${details.fallbackCategory || 'another category'}.`;
  if (entry.action === 'community_created') return `Created the ${details.name || 'community'} community.`;
  if (entry.action === 'sidebar_reordered') return `Reordered the sidebar (${details.channelCount || 0} channels).`;
  if (entry.action === 'message_removed') return `Removed a message in channel ${details.channelId || 'unknown'}.`;
  return entry.action.replaceAll('_', ' ');
}

async function showAdministration(view = 'overview') {
  settingsModal.style.display = 'grid';
  settingsModal.querySelectorAll('[data-settings-view]').forEach(button => button.classList.toggle('active', button.dataset.settingsView === view));
  const content = settingsModal.querySelector('#settingsContent');
  if (view !== 'audit') {
    const headings = { overview: 'Community Administration', roles: 'Roles & Permissions', moderation: 'Moderation', integrations: 'Integrations' };
    const notes = { overview: 'Manage the community configuration and review recorded administrative activity.', roles: 'Role management will appear here. It is not enabled yet.', moderation: 'Moderation controls will appear here. It is not enabled yet.', integrations: 'Approved integrations will appear here. It is not enabled yet.' };
    content.innerHTML = `<h2>${headings[view]}</h2><p>${notes[view]}</p>`;
    return;
  }
  content.innerHTML = '<h2>Audit Log</h2><p>Read-only activity history. Entries cannot be edited or deleted from this screen.</p><p>Loading activity…</p>';
  try {
    const result = await api(`/api/communities/${community.id}/audit-log`);
    content.innerHTML = `<h2>Audit Log</h2><p>Read-only activity history. Entries cannot be edited or deleted from this screen.</p>${result.entries.length ? result.entries.map(entry => `<article class="audit-entry"><strong>${esc(entry.actor.username)} — ${esc(auditDescription(entry))}</strong><small>${new Date(entry.createdAt).toLocaleString()}</small></article>`).join('') : '<p>No administrative activity has been recorded yet.</p>'}`;
  } catch (error) { content.innerHTML = `<h2>Audit Log</h2><p>${esc(error.message)}</p>`; }
}

settingsModal.querySelector('.settings-close').onclick = () => settingsModal.style.display = 'none';
settingsModal.querySelectorAll('[data-settings-view]').forEach(button => button.onclick = () => showAdministration(button.dataset.settingsView));

function contextMenu(event, items) {
  event.preventDefault();
  menu.innerHTML = '';
  items.forEach(item => {
    const button = document.createElement('button');
    button.textContent = item.label;
    button.style.cssText = `display:block;width:100%;border:0;background:transparent;color:${item.danger ? '#ff807d' : '#eee'};padding:9px 10px;text-align:left;border-radius:4px;font:600 12px Manrope;cursor:pointer`;
    button.onclick = () => { menu.style.display = 'none'; item.action(); };
    menu.append(button);
  });
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.display = 'block';
}

function openCreateModal(category, type = 'text') {
  channelModal.style.display = 'grid';
  channelModal.dataset.category = category.id;
  document.querySelector('#channelModalType').value = type;
  document.querySelector('#channelModalName').value = '';
  document.querySelector('#channelModalTitle').textContent = `Create ${titles[type].toLowerCase()}`;
  document.querySelector('#channelModalName').focus();
}

async function deleteCategory(category) {
  const enteredName = prompt(`This deletes the ${category.name} category. Its channels will be moved safely to another category.\n\nType ${category.name} to confirm.`);
  if (enteredName === null) return;
  if (enteredName.trim() !== category.name) {
    alert('The category name did not match. Nothing was deleted.');
    return;
  }
  try {
    const result = await api(`/api/communities/${community.id}/categories/${category.id}`, { method: 'DELETE' });
    alert(`${category.name} was deleted. ${result.movedChannelCount} channel${result.movedChannelCount === 1 ? '' : 's'} moved to ${result.fallbackCategory}.`);
    await select(community);
  } catch (error) { alert(error.message); }
}

function categoryActions(category) {
  return [
    { label: 'Create Text Channel', action: () => openCreateModal(category, 'text') },
    { label: 'Create Forum Channel', action: () => openCreateModal(category, 'forum') },
    { label: 'Create Voice Channel', action: () => openCreateModal(category, 'voice') },
    { label: 'Create Auditorium', action: () => openCreateModal(category, 'auditorium') },
    { label: 'Create Category', action: createCategory },
    { label: 'Delete Category', danger: true, action: () => deleteCategory(category) }
  ];
}

async function deleteChannel(channelItem) {
  const enteredName = prompt(`This permanently deletes the channel and its messages.\n\nType ${channelItem.name} to confirm.`);
  if (enteredName === null) return;
  if (enteredName.trim() !== channelItem.name) {
    alert('The channel name did not match. Nothing was deleted.');
    return;
  }
  try {
    await api(`/api/channels/${channelItem.id}`, { method: 'DELETE' });
    if (channel?.id === channelItem.id) {
      channel = null;
      form.hidden = true;
      messages.innerHTML = '<p class="empty">Channel deleted.</p>';
    }
    await select(community);
  } catch (error) { alert(error.message); }
}

function render(items, forum) {
  messages.innerHTML = items.length ? items.map(item => forum
    ? `<article style="background:#1a1b25;border:1px solid #323442;border-radius:9px;padding:15px"><h3>${esc(item.title)}</h3><small>${esc(item.author.username)} - ${new Date(item.createdAt).toLocaleString()}</small><p>${esc(item.body)}</p></article>`
    : `<article class="community-message"><span class="avatar">${esc(item.author.username.slice(0, 2))}</span><p><strong>${esc(item.author.username)}</strong><time>${new Date(item.createdAt).toLocaleString()}</time><br>${esc(item.body)}</p></article>`
  ).join('') : '<p class="empty">Nothing here yet.</p>';
}

function stopVoiceTest() {
  if (voiceTestStream) voiceTestStream.getTracks().forEach(track => track.stop());
  voiceTestStream = null;
}

function startVoiceTest(button, status) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status.textContent = 'Microphone testing is not supported in this browser.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Listening for 5 seconds…';
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    voiceTestStream = stream;
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => {
      stopVoiceTest();
      const playback = new Audio(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })));
      status.textContent = 'Recording complete. Playing back after a short delay…';
      setTimeout(() => playback.play().then(() => { status.textContent = 'Playback finished. Ready for another test.'; }).catch(() => { status.textContent = 'Playback was blocked. Press the test button again.'; }), 900);
      button.disabled = false;
    };
    recorder.start();
    setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 5000);
  }).catch(() => { button.disabled = false; status.textContent = 'Microphone permission was not granted.'; });
}

function voiceDock(roomChannel, room) {
  let dock = document.querySelector('#voiceDock');
  if (!dock) { dock = document.createElement('aside'); dock.id = 'voiceDock'; document.body.append(dock); }
  dock.innerHTML = `<strong style="display:block;color:#65d58a;font:700 13px Manrope">Voice Connected</strong><small style="display:block;color:#b6b7c2;margin:3px 0 10px">${esc(roomChannel.name)} - ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}</small><button id="voiceTestButton" style="border:0;border-radius:6px;padding:8px 10px;background:#293957;color:#d6e5ff;font:700 10px Manrope;cursor:pointer">🎙 Voice test</button><small id="voiceTestStatus" style="display:block;color:#9fa8bc;margin:7px 0 10px">Record 5 seconds, then hear it back.</small><button id="disconnectVoice" style="border:0;border-radius:6px;padding:8px 10px;background:#4a2930;color:#ffd0cb;font:700 10px Manrope;cursor:pointer">Disconnect</button>`;
  const testButton = document.querySelector('#voiceTestButton');
  testButton.onclick = () => startVoiceTest(testButton, document.querySelector('#voiceTestStatus'));
  document.querySelector('#disconnectVoice').onclick = async () => {
    stopVoiceTest();
    await api(`/api/channels/${roomChannel.id}/join`, { method: 'DELETE' });
    dock.remove();
    document.querySelectorAll(`[data-room-members="${roomChannel.id}"]`).forEach(node => node.remove());
  };
}

async function open(selectedChannel) {
  channel = selectedChannel;
  document.querySelector('#channelTitle').textContent = `${icons[channel.type] || '#'} ${channel.name}`;
  document.querySelector('#channelSubtitle').textContent = channel.description || community.name;
  document.querySelector('#channelType').textContent = titles[channel.type];
  if (['voice', 'auditorium'].includes(channel.type)) {
    form.hidden = true;
    await api(`/api/channels/${channel.id}/join`, { method: 'POST' });
    const room = await api(`/api/channels/${channel.id}/participants`);
    document.querySelectorAll('[data-room-members]').forEach(node => node.remove());
    const voiceButton = channels.querySelector(`[data-id="${channel.id}"]`);
    if (voiceButton) {
      const members = document.createElement('div');
      members.dataset.roomMembers = channel.id;
      members.style.cssText = 'padding:2px 8px 7px 27px;color:#c3c4cd;font:11px Manrope;display:grid;gap:5px';
      members.innerHTML = room.participants.map(person => `<span><i style="width:7px;height:7px;border-radius:50%;background:#5bd486;display:inline-block;margin-right:6px"></i>${esc(person.display_name)}</span>`).join('');
      voiceButton.after(members);
    }
    voiceDock(channel, room);
    messages.innerHTML = `<div class="empty"><strong>Joined ${titles[channel.type].toLowerCase()}</strong><br>You are now in this room.<br><br>Use the Voice Connected panel to disconnect.</div>`;
    return;
  }
  form.hidden = false;
  const result = await api(`/api/channels/${channel.id}/${channel.type === 'forum' ? 'forum-posts' : 'messages'}`);
  render(channel.type === 'forum' ? result.posts : result.messages, channel.type === 'forum');
}

async function saveOrder() {
  const orderedChannels = [];
  sidebar.categories.forEach(categoryItem => {
    sidebar.channels.filter(item => item.category_id === categoryItem.id).sort((a, b) => a.position - b.position)
      .forEach((item, position) => orderedChannels.push({ id: item.id, categoryId: categoryItem.id, position }));
  });
  await api(`/api/communities/${community.id}/sidebar`, { method: 'PUT', body: JSON.stringify({ categories: sidebar.categories.map(item => ({ id: item.id })), channels: orderedChannels }) });
}

async function moveChannel(channelId, destinationCategoryId, beforeChannelId) {
  const moved = sidebar.channels.find(item => item.id === channelId);
  if (!moved) return;
  moved.category_id = destinationCategoryId;
  const destination = sidebar.channels.filter(item => item.category_id === destinationCategoryId && item.id !== channelId).sort((a, b) => a.position - b.position);
  const insertionIndex = beforeChannelId ? destination.findIndex(item => item.id === beforeChannelId) : destination.length;
  destination.splice(insertionIndex < 0 ? destination.length : insertionIndex, 0, moved);
  sidebar.categories.forEach(categoryItem => {
    const ordered = categoryItem.id === destinationCategoryId ? destination : sidebar.channels.filter(item => item.category_id === categoryItem.id && item.id !== channelId).sort((a, b) => a.position - b.position);
    ordered.forEach((item, position) => item.position = position);
  });
  await saveOrder();
  await select(community);
}

function attachChannelDrag(button, selectedChannel) {
  if (!canEdit()) return;
  let startX, startY, dragging = false, hoverTarget;
  button.onpointerdown = event => {
    if (event.button !== 0) return;
    startX = event.clientX; startY = event.clientY;
    const move = moveEvent => {
      if (!dragging && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 7) return;
      dragging = true;
      button.style.opacity = '.45';
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
      const nextTarget = target?.closest('#channelList button[data-id]');
      if (hoverTarget && hoverTarget !== nextTarget) hoverTarget.style.boxShadow = '';
      hoverTarget = nextTarget;
      if (hoverTarget && hoverTarget !== button) hoverTarget.style.boxShadow = 'inset 0 2px 0 #ff8d82';
    };
    const end = async endEvent => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', end);
      button.style.opacity = '';
      if (hoverTarget) hoverTarget.style.boxShadow = '';
      if (!dragging) return;
      suppressChannelClickUntil = Date.now() + 350;
      const target = document.elementFromPoint(endEvent.clientX, endEvent.clientY);
      const targetButton = target?.closest('#channelList button[data-id]');
      const targetSection = target?.closest('#channelList section[data-category]');
      const categoryId = Number(targetSection?.dataset.category || targetButton?.closest('section[data-category]')?.dataset.category);
      if (!categoryId) return;
      await moveChannel(selectedChannel.id, categoryId, targetButton && Number(targetButton.dataset.id) !== selectedChannel.id ? Number(targetButton.dataset.id) : null);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end, { once: true });
  };
}

function draw() {
  channels.innerHTML = '';
  const administration = document.querySelector('#communityAdmin');
  administration.innerHTML = '';
  if (canEdit()) {
    const cog = document.createElement('button');
    cog.className = 'admin-cog';
    cog.style.display = 'block';
    cog.innerHTML = `Administration <span aria-hidden="true">⚙</span>`;
    cog.onclick = () => showAdministration();
    administration.append(cog);
  }
  sidebar.categories.forEach(categoryItem => {
    const section = document.createElement('section');
    section.dataset.category = categoryItem.id;
    const head = document.createElement('h2');
    const name = document.createElement('span'); name.textContent = categoryItem.name;
    head.append(name);
    if (canEdit()) {
      const plus = document.createElement('button');
      plus.type = 'button'; plus.className = 'category-add'; plus.textContent = '+'; plus.title = `Create channel in ${categoryItem.name}`;
      plus.onclick = event => { event.stopPropagation(); openCreateModal(categoryItem, 'text'); };
      head.append(plus);
    }
    head.oncontextmenu = event => canEdit() && contextMenu(event, categoryActions(categoryItem));
    section.append(head);
    const group = document.createElement('div');
    group.className = 'category-drop-zone';
    sidebar.channels.filter(item => item.category_id === categoryItem.id).sort((a, b) => a.position - b.position).forEach(channelItem => {
      const button = document.createElement('button');
      button.dataset.id = channelItem.id;
      button.textContent = `${icons[channelItem.type]} ${channelItem.name}`;
      button.onclick = () => { if (Date.now() >= suppressChannelClickUntil) open(channelItem); };
      attachChannelDrag(button, channelItem);
      button.oncontextmenu = event => canEdit() && contextMenu(event, [
        { label: 'Open Channel', action: () => open(channelItem) },
        ...categoryActions(categoryItem),
        { label: 'Delete Channel', danger: true, action: () => deleteChannel(channelItem) }
      ]);
      group.append(button);
    });
    section.append(group);
    channels.append(section);
  });
}

document.querySelector('.community-side').addEventListener('contextmenu', event => {
  if (event.target.closest('#channelList button,#channelList h2')) return;
  if (canEdit() && sidebar?.categories?.length) contextMenu(event, categoryActions(sidebar.categories[0]));
});

document.querySelector('#channelModalCancel').onclick = () => channelModal.style.display = 'none';
channelModal.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const name = document.querySelector('#channelModalName').value.trim();
  const type = document.querySelector('#channelModalType').value;
  const categoryId = Number(channelModal.dataset.category);
  if (!name) return;
  try {
    await api(`/api/communities/${community.id}/channels`, { method: 'POST', body: JSON.stringify({ name, type, categoryId }) });
    channelModal.style.display = 'none';
    await select(community);
  } catch (error) { alert(error.message); }
};

function createCategory() {
  const name = prompt('Category name');
  if (name) api(`/api/communities/${community.id}/categories`, { method: 'POST', body: JSON.stringify({ name }) }).then(() => select(community)).catch(error => alert(error.message));
}

async function select(selectedCommunity) {
  community = selectedCommunity;
  sidebar = await api(`/api/communities/${community.id}/channels`);
  draw();
  if (sidebar.channels[0]) open(sidebar.channels[0]);
}

async function load() {
  const result = await api('/api/communities');
  list.innerHTML = '';
  result.communities.forEach(item => { const button = document.createElement('button'); button.textContent = item.name; button.onclick = () => select(item); list.append(button); });
  if (result.communities[0]) select(result.communities[0]);
}

form.onsubmit = async event => {
  event.preventDefault();
  const body = document.querySelector('#messageInput').value.trim();
  if (!body) return;
  try {
    if (channel.type === 'forum') {
      const title = prompt('Forum topic title');
      if (!title) return;
      await api(`/api/channels/${channel.id}/forum-posts`, { method: 'POST', body: JSON.stringify({ title, body }) });
    } else await api(`/api/channels/${channel.id}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
    document.querySelector('#messageInput').value = '';
    open(channel);
  } catch (error) { alert(error.message); }
};

(async () => {
  if (!token) return location.assign('auth.html');
  try { user = (await api('/api/me')).user; await load(); } catch { sessionStorage.clear(); location.assign('auth.html'); }
})();
