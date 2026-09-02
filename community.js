const token = sessionStorage.getItem('emberfansToken');
const list = document.querySelector('#communityList');
const channels = document.querySelector('#channelList');
const messages = document.querySelector('#messageList');
const form = document.querySelector('#messageForm');
let user, community, channel, sidebar, suppressChannelClickUntil = 0;

const icons = { text: '#', forum: '[]', voice: '()', auditorium: '()' };
const titles = { text: 'TEXT CHANNEL', forum: 'FORUM CHANNEL', voice: 'VOICE CHANNEL', auditorium: 'AUDITORIUM' };

const menu = document.createElement('div');
menu.style.cssText = 'display:none;position:fixed;z-index:20;min-width:190px;padding:7px;background:#26272f;border:1px solid #3b3d49;border-radius:7px;box-shadow:0 12px 35px #0008';
document.body.append(menu);
document.addEventListener('click', () => menu.style.display = 'none');

const channelModal = document.createElement('div');
channelModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:30;place-items:center;background:#08090dbb';
channelModal.innerHTML = '<form style="width:min(380px,calc(100% - 30px));padding:24px;background:#20212a;border:1px solid #40424e;border-radius:10px;display:grid;gap:14px"><strong id="channelModalTitle" style="font-size:18px">Create Channel</strong><label style="display:grid;gap:6px;font-size:11px">Channel name<input id="channelModalName" maxlength="48" required style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"></label><label style="display:grid;gap:6px;font-size:11px">Channel type<select id="channelModalType" style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"><option value="text">Text channel</option><option value="forum">Forum channel</option><option value="voice">Voice channel</option><option value="auditorium">Auditorium</option></select></label><div style="display:flex;justify-content:end;gap:8px"><button type="button" id="channelModalCancel" class="secondary-button">Cancel</button><button class="primary-button">Create channel</button></div></form>';
document.body.append(channelModal);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const body = response.status === 204 ? {} : await response.json();
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

function categoryActions(category) {
  return [
    { label: 'Create Text Channel', action: () => openCreateModal(category, 'text') },
    { label: 'Create Forum Channel', action: () => openCreateModal(category, 'forum') },
    { label: 'Create Voice Channel', action: () => openCreateModal(category, 'voice') },
    { label: 'Create Auditorium', action: () => openCreateModal(category, 'auditorium') },
    { label: 'Create Category', action: createCategory }
  ];
}

function render(items, forum) {
  messages.innerHTML = items.length ? items.map(item => forum
    ? `<article style="background:#1a1b25;border:1px solid #323442;border-radius:9px;padding:15px"><h3>${esc(item.title)}</h3><small>${esc(item.author.username)} - ${new Date(item.createdAt).toLocaleString()}</small><p>${esc(item.body)}</p></article>`
    : `<article class="community-message"><span class="avatar">${esc(item.author.username.slice(0, 2))}</span><p><strong>${esc(item.author.username)}</strong><time>${new Date(item.createdAt).toLocaleString()}</time><br>${esc(item.body)}</p></article>`
  ).join('') : '<p class="empty">Nothing here yet.</p>';
}

function voiceDock(roomChannel, room) {
  let dock = document.querySelector('#voiceDock');
  if (!dock) { dock = document.createElement('aside'); dock.id = 'voiceDock'; document.body.append(dock); }
  dock.innerHTML = `<strong style="display:block;color:#65d58a;font:700 13px Manrope">Voice Connected</strong><small style="display:block;color:#b6b7c2;margin:3px 0 10px">${esc(roomChannel.name)} - ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}</small><button id="disconnectVoice" style="border:0;border-radius:6px;padding:8px 10px;background:#4a2930;color:#ffd0cb;font:700 10px Manrope;cursor:pointer">Disconnect</button>`;
  document.querySelector('#disconnectVoice').onclick = async () => {
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
      button.oncontextmenu = event => canEdit() && contextMenu(event, [{ label: 'Open Channel', action: () => open(channelItem) }, ...categoryActions(categoryItem)]);
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
