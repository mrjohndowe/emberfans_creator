const token = sessionStorage.getItem('emberfansToken');
const list = document.querySelector('#communityList');
const channels = document.querySelector('#channelList');
const messages = document.querySelector('#messageList');
const form = document.querySelector('#messageForm');
let user, community, channel, sidebar, suppressChannelClickUntil = 0;
let voiceTestStream = null;
let liveRoom = null;

const icons = { text: '#', forum: '▤', media: '▦', voice: '🔊', auditorium: '🎙' };
const titles = { text: 'TEXT CHANNEL', forum: 'FORUM CHANNEL', media: 'MEDIA CHANNEL', voice: 'VOICE CHANNEL', auditorium: 'AUDITORIUM' };

const menu = document.createElement('div');
menu.style.cssText = 'display:none;position:fixed;z-index:20;min-width:190px;padding:7px;background:#26272f;border:1px solid #3b3d49;border-radius:7px;box-shadow:0 12px 35px #0008';
document.body.append(menu);
document.addEventListener('click', () => menu.style.display = 'none');

const channelModal = document.createElement('div');
channelModal.style.cssText = 'display:none;position:fixed;inset:0;z-index:30;place-items:center;background:#08090dbb';
channelModal.innerHTML = '<form style="width:min(380px,calc(100% - 30px));padding:24px;background:#20212a;border:1px solid #40424e;border-radius:10px;display:grid;gap:14px"><strong id="channelModalTitle" style="font-size:18px">Create Channel</strong><label style="display:grid;gap:6px;font-size:11px">Channel name<input id="channelModalName" maxlength="48" required style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"></label><label style="display:grid;gap:6px;font-size:11px">Channel type<select id="channelModalType" style="padding:10px;border:1px solid #444651;border-radius:6px;background:#13141b;color:#fff"><option value="text">Text channel</option><option value="forum">Forum channel</option><option value="media">Media channel</option><option value="voice">Voice channel</option><option value="auditorium">Auditorium</option></select></label><div style="display:flex;justify-content:end;gap:8px"><button type="button" id="channelModalCancel" class="secondary-button">Cancel</button><button class="primary-button">Create channel</button></div></form>';
document.body.append(channelModal);

const settingsModal = document.createElement('div');
settingsModal.className = 'settings-modal';
settingsModal.innerHTML = '<section class="settings-card"><nav class="settings-nav"><strong>Administration</strong><button class="active" data-settings-view="overview">Overview</button><button data-settings-view="audit">Audit Log</button><button data-settings-view="roles">Roles & Permissions</button><button data-settings-view="moderation">Moderation</button><button data-settings-view="integrations">Integrations</button></nav><main class="settings-main"><button class="settings-close" aria-label="Close administration settings">×</button><div id="settingsContent"></div></main></section>';
document.body.append(settingsModal);

const membershipModal = document.createElement('div');
membershipModal.className = 'settings-modal';
membershipModal.innerHTML = '<section class="membership-card"><button class="settings-close" aria-label="Close membership">×</button><div id="membershipContent"></div></section>';
document.body.append(membershipModal);

const mediaUploadModal = document.createElement('div');
mediaUploadModal.className = 'settings-modal';
mediaUploadModal.innerHTML = '<form class="media-upload-card"><button type="button" class="settings-close" aria-label="Close upload">×</button><h2>Upload to Media</h2><p>Photos, videos, and GIFs appear in this gallery. Choose the audience before publishing.</p><label>Title<input id="mediaUploadTitle" maxlength="120" required></label><label>Media type<select id="mediaUploadKind"><option value="sfw_photo">Photo or GIF</option><option value="nsfw_photo">18+ Photo or GIF</option><option value="video">Video</option></select></label><label>Audience<select id="mediaUploadAccess"><option value="free">Free</option><option value="subscriber">Subscribers</option><option value="purchase">One-time purchase</option></select></label><label>File<input id="mediaUploadFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" required></label><button class="primary-button">Upload media</button><small id="mediaUploadStatus"></small></form>';
document.body.append(mediaUploadModal);

const threadModal = document.createElement('div');
threadModal.className = 'settings-modal';
threadModal.innerHTML = '<section class="thread-card"><button class="settings-close" aria-label="Close thread">×</button><div id="threadContent"></div></section>';
document.body.append(threadModal);

const mediaViewerModal = document.createElement('div');
mediaViewerModal.className = 'settings-modal';
mediaViewerModal.innerHTML = '<section class="media-viewer-card"><button class="settings-close" aria-label="Close media viewer">×</button><div id="mediaViewerContent"></div></section>';
document.body.append(mediaViewerModal);
let mediaViewerUrl = null;

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
  return user && (['owner', 'administrator', 'moderator'].includes(community?.member_role) || user.role === 'admin');
}

function canUploadToMedia() {
  return user && (['admin', 'performer'].includes(user.role) || ['owner', 'administrator', 'moderator', 'creator'].includes(community?.member_role));
}

function channelKind(channelItem) {
  return channelItem.display_mode === 'gallery' ? 'media' : channelItem.type;
}

function canManageMedia(item) {
  return user?.role === 'admin' || item.performer_id === user?.id;
}

function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((Number(cents) || 0) / 100);
}

async function openMembership() {
  if (!community) return;
  membershipModal.style.display = 'grid';
  const content = membershipModal.querySelector('#membershipContent');
  content.innerHTML = '<h2>Community membership</h2><p>Loading membership options…</p>';
  try {
    const result = await api(`/api/communities/${community.id}/plans`);
    const active = result.subscription?.status === 'active';
    const plans = result.plans.map(plan => `<article class="membership-plan"><div><strong>${esc(plan.name)}</strong><small>${money(plan.price_cents)} / ${esc(plan.interval)}</small></div>${active && result.subscription.plan_id === plan.id ? '<b>Active</b>' : `<button data-plan-id="${plan.id}">Start demo membership</button>`}</article>`).join('');
    content.innerHTML = `<h2>${esc(community.name)} membership</h2><p>${active ? `You have an active ${esc(result.subscription.plan_name)} membership.` : 'Unlock subscriber-only media in this community.'}</p><p class="membership-demo">Demo mode: this activates access without taking a payment. Real checkout comes after an adult-content-compatible payment provider is connected.</p><section class="membership-plans">${plans || '<p>No membership options are available yet.</p>'}</section>`;
    content.querySelectorAll('[data-plan-id]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'Activating…';
      try { await api(`/api/communities/${community.id}/subscribe-demo`, { method: 'POST', body: JSON.stringify({ planId: Number(button.dataset.planId) }) }); await openMembership(); await renderGallery(); }
      catch (error) { alert(error.message); button.disabled = false; button.textContent = 'Start demo membership'; }
    });
  } catch (error) { content.innerHTML = `<h2>Community membership</h2><p>${esc(error.message)}</p>`; }
}

async function unlockMediaDemo(item) {
  try {
    await api(`/api/content/${item.id}/unlock-demo`, { method: 'POST' });
    closeMediaViewer();
    await renderGallery();
  } catch (error) { alert(error.message); }
}

async function deleteForumPost(post) {
  const enteredTitle = prompt(`Type ${post.title} to permanently delete this discussion.`);
  if (enteredTitle === null) return;
  if (enteredTitle.trim() !== post.title) return alert('The discussion title did not match. Nothing was deleted.');
  try { await api(`/api/forum-posts/${post.id}`, { method: 'DELETE' }); await open(channel); } catch (error) { alert(error.message); }
}

async function deleteMediaItem(item) {
  const enteredTitle = prompt(`Type ${item.title} to permanently delete this media item.`);
  if (enteredTitle === null) return;
  if (enteredTitle.trim() !== item.title) return alert('The media title did not match. Nothing was deleted.');
  try { await api(`/api/content/${item.id}`, { method: 'DELETE' }); await renderGallery(); } catch (error) { alert(error.message); }
}

async function deleteMessage(message) {
  if (!confirm('Delete this message?')) return;
  try { await api(`/api/channel-messages/${message.id}`, { method: 'DELETE' }); await open(channel); } catch (error) { alert(error.message); }
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
  if (entry.action === 'forum_post_removed') return `Removed a forum thread in channel ${details.channelId || 'unknown'}.`;
  if (entry.action === 'forum_reply_removed') return `Removed a forum reply in channel ${details.channelId || 'unknown'}.`;
  if (entry.action === 'media_uploaded') return `Uploaded media item ${details.title || 'unknown'}.`;
  if (entry.action === 'member_role_changed') return `Changed a member role to ${details.role || 'member'}.`;
  if (entry.action === 'media_deleted') return `Deleted media item ${details.title || 'unknown'}.`;
  return entry.action.replaceAll('_', ' ');
}

async function showAdministration(view = 'overview') {
  settingsModal.style.display = 'grid';
  settingsModal.querySelectorAll('[data-settings-view]').forEach(button => button.classList.toggle('active', button.dataset.settingsView === view));
  const content = settingsModal.querySelector('#settingsContent');
  if (view === 'roles') {
    content.innerHTML = '<h2>Roles & Permissions</h2><p>Loading community members…</p>';
    try {
      const result = await api(`/api/communities/${community.id}/members`);
      const permissions = '<section class="role-permissions"><strong>Role permissions</strong><p><b>Owner</b> — full control, including role assignment.</p><p><b>Administrator</b> — manage channels, categories, content, and moderation.</p><p><b>Moderator</b> — manage channels, categories, and moderation.</p><p><b>Creator</b> — upload to Media channels.</p><p><b>Subscriber</b> / <b>Member</b> — standard community participation.</p></section>';
      const members = result.members.map(member => `<article class="role-member"><span class="avatar">${esc(member.display_name.slice(0, 2))}</span><div><strong>${esc(member.display_name)}</strong><small>${esc(member.account_role)} account</small></div>${member.membership_role === 'owner' ? '<b class="role-owner">Owner</b>' : result.canManageRoles ? `<select data-role-member="${member.id}"><option value="administrator" ${member.community_role === 'administrator' ? 'selected' : ''}>Administrator</option><option value="moderator" ${member.community_role === 'moderator' ? 'selected' : ''}>Moderator</option><option value="creator" ${member.community_role === 'creator' ? 'selected' : ''}>Creator</option><option value="subscriber" ${member.community_role === 'subscriber' ? 'selected' : ''}>Subscriber</option><option value="member" ${member.community_role === 'member' ? 'selected' : ''}>Member</option></select>` : `<b class="role-owner">${esc(member.community_role)}</b>`}</article>`).join('');
      content.innerHTML = `<h2>Roles & Permissions</h2><p>${result.canManageRoles ? 'Choose a role for each member. The owner cannot be changed here.' : 'You can review roles, but only the owner or a global administrator can change them.'}</p>${permissions}<section class="role-members">${members || '<p>No members found.</p>'}</section>`;
      content.querySelectorAll('[data-role-member]').forEach(select => select.onchange = async () => {
        try { await api(`/api/communities/${community.id}/members/${select.dataset.roleMember}/role`, { method: 'PUT', body: JSON.stringify({ role: select.value }) }); await showAdministration('roles'); }
        catch (error) { alert(error.message); await showAdministration('roles'); }
      });
    } catch (error) { content.innerHTML = `<h2>Roles & Permissions</h2><p>${esc(error.message)}</p>`; }
    return;
  }
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
membershipModal.querySelector('.settings-close').onclick = () => membershipModal.style.display = 'none';
settingsModal.querySelectorAll('[data-settings-view]').forEach(button => button.onclick = () => showAdministration(button.dataset.settingsView));
mediaUploadModal.querySelector('.settings-close').onclick = () => mediaUploadModal.style.display = 'none';
mediaUploadModal.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const title = document.querySelector('#mediaUploadTitle').value.trim();
  const kind = document.querySelector('#mediaUploadKind').value;
  const accessType = document.querySelector('#mediaUploadAccess').value;
  const file = document.querySelector('#mediaUploadFile').files[0];
  const status = document.querySelector('#mediaUploadStatus');
  if (!channel || channelKind(channel) !== 'media' || !file) return;
  status.textContent = 'Uploading…';
  try {
    const created = await api('/api/content', { method: 'POST', body: JSON.stringify({ title, kind, accessType, channelId: channel.id }) });
    const payload = new FormData();
    payload.append('media', file);
    const response = await fetch(`/api/content/${created.item.id}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: payload });
    if (!response.ok) {
      const error = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
      await api(`/api/content/${created.item.id}`, { method: 'DELETE' });
      throw Error(error.error || 'Upload failed.');
    }
    mediaUploadModal.style.display = 'none';
    event.target.reset();
    await renderGallery();
  } catch (error) { status.textContent = error.message; }
};
threadModal.querySelector('.settings-close').onclick = () => threadModal.style.display = 'none';
function closeMediaViewer() {
  mediaViewerModal.style.display = 'none';
  if (mediaViewerUrl) URL.revokeObjectURL(mediaViewerUrl);
  mediaViewerUrl = null;
  mediaViewerModal.querySelector('#mediaViewerContent').innerHTML = '';
}
mediaViewerModal.querySelector('.settings-close').onclick = closeMediaViewer;

async function openMediaViewer(item) {
  mediaViewerModal.style.display = 'grid';
  const content = mediaViewerModal.querySelector('#mediaViewerContent');
  content.innerHTML = '<p>Loading media…</p>';
  if (!item.mediaUrl) {
    const action = item.access_type === 'subscriber'
      ? '<button id="mediaMembershipButton" class="primary-button">View membership</button>'
      : item.access_type === 'purchase' ? '<button id="mediaUnlockButton" class="primary-button">Demo unlock</button>' : '';
    content.innerHTML = `<h2>${esc(item.title)}</h2><p>This media requires an active ${esc(item.access_type)} entitlement before it can be viewed.</p>${action}`;
    content.querySelector('#mediaMembershipButton')?.addEventListener('click', openMembership);
    content.querySelector('#mediaUnlockButton')?.addEventListener('click', () => unlockMediaDemo(item));
    return;
  }
  try {
    const response = await fetch(item.mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw Error('This media is not available to your account.');
    mediaViewerUrl = URL.createObjectURL(await response.blob());
    const viewer = item.kind === 'video' ? `<video src="${mediaViewerUrl}" controls autoplay playsinline></video>` : `<img src="${mediaViewerUrl}" alt="${esc(item.title)}">`;
    content.innerHTML = `<div class="media-viewer-stage">${viewer}</div><h2>${esc(item.title)}</h2><p>${esc(item.performer_name)} · ${esc(item.access_type)}</p>`;
  } catch (error) { content.innerHTML = `<p>${esc(error.message)}</p>`; }
}

async function openForumThread(post) {
  threadModal.style.display = 'grid';
  const content = threadModal.querySelector('#threadContent');
  content.innerHTML = '<p>Loading thread…</p>';
  try {
    const result = await api(`/api/forum-posts/${post.id}/replies`);
    const replies = result.replies.map(reply => `<article class="thread-reply"><strong>${esc(reply.author.username)}</strong><time>${new Date(reply.createdAt).toLocaleString()}</time><p>${esc(reply.body)}</p>${(reply.author.id === user.id || canEdit()) ? `<button class="inline-delete" data-reply-id="${reply.id}">Delete</button>` : ''}</article>`).join('');
    content.innerHTML = `<span class="thread-kicker">FORUM THREAD</span><h2>${esc(result.post.title)}</h2><article class="thread-starter"><p>${esc(result.post.body)}</p></article><section class="thread-replies">${replies || '<p class="thread-none">No replies yet. Start the discussion.</p>'}</section><form id="threadReplyForm" class="thread-reply-form"><input id="threadReplyInput" maxlength="4000" placeholder="Reply to this thread" required><button>Reply</button></form>`;
    result.replies.forEach(reply => content.querySelector(`[data-reply-id="${reply.id}"]`)?.addEventListener('click', async () => {
      if (!confirm('Delete this reply?')) return;
      try { await api(`/api/forum-replies/${reply.id}`, { method: 'DELETE' }); await openForumThread(post); } catch (error) { alert(error.message); }
    }));
    content.querySelector('#threadReplyForm').onsubmit = async event => {
      event.preventDefault();
      const body = content.querySelector('#threadReplyInput').value.trim();
      if (!body) return;
      try { await api(`/api/forum-posts/${post.id}/replies`, { method: 'POST', body: JSON.stringify({ body }) }); await openForumThread(post); } catch (error) { alert(error.message); }
    };
  } catch (error) { content.innerHTML = `<p>${esc(error.message)}</p>`; }
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
    { label: 'Create Media Channel', action: () => openCreateModal(category, 'media') },
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

function render(items) {
  messages.classList.remove('forum-view');
  messages.classList.remove('gallery-view');
  messages.innerHTML = items.length ? items.map(item => `<article class="community-message"><span class="avatar">${esc(item.author.username.slice(0, 2))}</span><p><strong>${esc(item.author.username)}</strong><time>${new Date(item.createdAt).toLocaleString()}</time><br>${esc(item.body)}</p>${(item.author.id === user.id || canEdit()) ? `<button class="inline-delete" data-message-id="${item.id}">Delete</button>` : ''}</article>`).join('') : '<p class="empty">Nothing here yet.</p>';
  items.forEach(item => messages.querySelector(`[data-message-id="${item.id}"]`)?.addEventListener('click', () => deleteMessage(item)));
}

function renderForum(posts) {
  messages.classList.remove('gallery-view');
  messages.classList.add('forum-view');
  const discussions = posts.length ? posts.map(post => `<article class="forum-post" data-thread-id="${post.id}"><div class="forum-post-icon">▤</div><div><h3>${esc(post.title)}</h3><p>${esc(post.body)}</p><small>Started by <b>${esc(post.author.username)}</b> · ${new Date(post.createdAt).toLocaleString()}</small></div><span class="forum-replies">${post.replyCount || 0} replies</span>${(post.author.id === user.id || canEdit()) ? `<button class="inline-delete" data-forum-post-id="${post.id}">Delete</button>` : ''}</article>`).join('') : '<div class="forum-empty"><div>▤</div><h2>No discussions yet</h2><p>Start the first conversation in this forum.</p></div>';
  messages.innerHTML = `<section class="forum-hero"><span>FORUM</span><h2>${esc(channel.name)}</h2><p>Browse discussions or start a new topic for this community.</p></section><section class="forum-topic-list"><div class="forum-list-heading"><strong>Discussions</strong><span>${posts.length} topic${posts.length === 1 ? '' : 's'}</span></div>${discussions}</section>`;
  posts.forEach(post => {
    messages.querySelector(`[data-thread-id="${post.id}"]`)?.addEventListener('click', event => { if (!event.target.closest('.inline-delete')) openForumThread(post); });
    messages.querySelector(`[data-forum-post-id="${post.id}"]`)?.addEventListener('click', () => deleteForumPost(post));
  });
}

async function renderGallery() {
  messages.classList.remove('forum-view');
  messages.classList.add('gallery-view');
  messages.innerHTML = `<section class="gallery-hero"><span>MEDIA GALLERY</span><h2>Creator media</h2><p>Photos, videos, and GIFs shared by creators. This channel has no chat.</p><button id="membershipButton" class="gallery-membership">Membership</button>${canUploadToMedia() ? '<button id="uploadMediaButton" class="gallery-upload">Upload media</button>' : ''}</section><section class="gallery-grid"><p class="empty">Loading media…</p></section>`;
  messages.querySelector('#uploadMediaButton')?.addEventListener('click', () => { mediaUploadModal.style.display = 'grid'; document.querySelector('#mediaUploadTitle').focus(); });
  messages.querySelector('#membershipButton')?.addEventListener('click', openMembership);
  try {
    const result = await api(`/api/content?channelId=${channel.id}`);
    const items = result.items.filter(item => ['sfw_photo', 'nsfw_photo', 'video'].includes(item.kind));
    const grid = messages.querySelector('.gallery-grid');
    grid.innerHTML = items.length ? items.map(item => `<article class="gallery-card" data-media-id="${item.id}"><div class="gallery-visual ${item.kind} ${item.hasAccess ? '' : 'locked'}"><span>${item.hasAccess ? (item.kind === 'video' ? '▶' : '▦') : '🔒'}</span></div><div><strong>${esc(item.title)}</strong><small>${esc(item.performer_name)} · ${item.access_type}</small>${canManageMedia(item) ? `<button class="gallery-delete" data-media-delete-id="${item.id}">Delete</button>` : ''}</div></article>`).join('') : '<div class="gallery-empty"><div>▦</div><h2>No media yet</h2><p>Creator uploads will appear here.</p></div>';
    items.forEach(item => {
      grid.querySelector(`[data-media-id="${item.id}"]`)?.addEventListener('click', event => { if (!event.target.closest('.gallery-delete')) openMediaViewer(item); });
      grid.querySelector(`[data-media-id="${item.id}"]`)?.addEventListener('contextmenu', event => contextMenu(event, [
        { label: 'Open Media', action: () => openMediaViewer(item) },
        ...(canManageMedia(item) ? [{ label: 'Delete Media', danger: true, action: () => deleteMediaItem(item) }] : [])
      ]));
      grid.querySelector(`[data-media-delete-id="${item.id}"]`)?.addEventListener('click', () => deleteMediaItem(item));
    });
    items.filter(item => item.mediaUrl).forEach(async item => {
      try {
        const response = await fetch(item.mediaUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        const target = grid.querySelector(`[data-media-id="${item.id}"] .gallery-visual`);
        if (target) target.innerHTML = item.kind === 'video' ? `<video src="${url}" muted preload="metadata"></video><span>▶</span>` : `<img src="${url}" alt="${esc(item.title)}">`;
      } catch { /* A gallery card remains available without a preview. */ }
    });
  } catch (error) { messages.querySelector('.gallery-grid').innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
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

function leaveLiveRoom() {
  if (!liveRoom) return;
  liveRoom.socket?.close();
  liveRoom.peers.forEach(peer => peer.connection.close());
  liveRoom.stream?.getTracks().forEach(track => track.stop());
  liveRoom = null;
}

function sendRoomSignal(targetClientId, signal) {
  if (liveRoom?.socket?.readyState === WebSocket.OPEN) liveRoom.socket.send(JSON.stringify({ type: 'signal', targetClientId, signal }));
}

function addRemoteVideo(clientId, displayName, stream) {
  const grid = document.querySelector('#roomVideoGrid');
  if (!grid) return;
  let tile = grid.querySelector(`[data-peer-video="${clientId}"]`);
  if (!tile) {
    tile = document.createElement('article');
    tile.className = 'room-video-tile';
    tile.dataset.peerVideo = clientId;
    tile.innerHTML = `<video autoplay playsinline></video><span>${esc(displayName || 'Participant')}</span>`;
    grid.append(tile);
  }
  tile.querySelector('video').srcObject = stream;
}

function createPeer(clientId, displayName, initiate = false) {
  if (!liveRoom) return null;
  const existing = liveRoom.peers.get(clientId);
  if (existing?.connection) return existing.connection;
  const connection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const peer = { connection, displayName: existing?.displayName || displayName };
  liveRoom.peers.set(clientId, peer);
  liveRoom.stream?.getTracks().forEach(track => connection.addTrack(track, liveRoom.stream));
  connection.onicecandidate = event => { if (event.candidate) sendRoomSignal(clientId, { candidate: event.candidate }); };
  connection.ontrack = event => addRemoteVideo(clientId, displayName, event.streams[0]);
  connection.onconnectionstatechange = () => {
    if (['failed', 'closed', 'disconnected'].includes(connection.connectionState)) document.querySelector(`[data-peer-video="${clientId}"]`)?.remove();
  };
  if (initiate) connection.createOffer().then(offer => connection.setLocalDescription(offer)).then(() => sendRoomSignal(clientId, { description: connection.localDescription })).catch(() => {});
  return connection;
}

async function handleRoomSignal(clientId, signal) {
  if (!liveRoom) return;
  const connection = liveRoom.peers.get(clientId)?.connection || createPeer(clientId, liveRoom.peers.get(clientId)?.displayName || 'Participant');
  try {
    if (signal.description) {
      await connection.setRemoteDescription(signal.description);
      if (signal.description.type === 'offer') {
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        sendRoomSignal(clientId, { description: connection.localDescription });
      }
    } else if (signal.candidate) await connection.addIceCandidate(signal.candidate);
  } catch { /* The peer can reconnect by reopening the room. */ }
}

async function enableLiveMedia() {
  if (!liveRoom) return;
  const status = document.querySelector('#liveRoomStatus');
  const button = document.querySelector('#enableLiveMedia');
  button.disabled = true;
  status.textContent = 'Requesting microphone and camera access…';
  try {
    liveRoom.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    const local = document.querySelector('#localRoomVideo');
    local.srcObject = liveRoom.stream;
    document.querySelector('#localRoomTile')?.classList.add('active');
    liveRoom.peers.forEach((peer, clientId) => {
      const connection = peer.connection || createPeer(clientId, peer.displayName || 'Participant');
      if (peer.connection) liveRoom.stream.getTracks().forEach(track => connection.addTrack(track, liveRoom.stream));
      connection.createOffer().then(offer => connection.setLocalDescription(offer)).then(() => sendRoomSignal(clientId, { description: connection.localDescription })).catch(() => {});
    });
    liveRoom.socket?.send(JSON.stringify({ type: 'media-ready' }));
    status.textContent = 'Microphone and camera are live.';
    button.textContent = 'Mic & camera enabled';
  } catch { button.disabled = false; status.textContent = 'Microphone/camera permission was not granted.'; }
}

function connectLiveRoom(roomChannel) {
  leaveLiveRoom();
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws/rooms?token=${encodeURIComponent(token)}&channelId=${roomChannel.id}`);
  liveRoom = { channelId: roomChannel.id, socket, peers: new Map(), stream: null };
  socket.onopen = () => { const status = document.querySelector('#liveRoomStatus'); if (status) status.textContent = 'Connected to the room. Enable your mic and camera when ready.'; };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'room-welcome') message.peers.forEach(peer => liveRoom.peers.set(peer.clientId, { displayName: peer.displayName, connection: null }));
    if (message.type === 'peer-joined') {
      liveRoom.peers.set(message.clientId, { displayName: message.displayName, connection: null });
      if (liveRoom.stream) createPeer(message.clientId, message.displayName, true);
    }
    if (message.type === 'peer-media-ready' && liveRoom.stream) createPeer(message.clientId, liveRoom.peers.get(message.clientId)?.displayName || 'Participant', true);
    if (message.type === 'signal') handleRoomSignal(message.clientId, message.signal);
    if (message.type === 'peer-left') { liveRoom.peers.get(message.clientId)?.connection?.close(); liveRoom.peers.delete(message.clientId); document.querySelector(`[data-peer-video="${message.clientId}"]`)?.remove(); }
  };
  socket.onclose = () => { const status = document.querySelector('#liveRoomStatus'); if (status && liveRoom) status.textContent = 'Room signaling disconnected.'; };
}

function voiceDock(roomChannel, room) {
  let dock = document.querySelector('#voiceDock');
  if (!dock) { dock = document.createElement('aside'); dock.id = 'voiceDock'; document.body.append(dock); }
  dock.innerHTML = `<strong style="display:block;color:#65d58a;font:700 13px Manrope">Voice Connected</strong><small style="display:block;color:#b6b7c2;margin:3px 0 10px">${esc(roomChannel.name)} - ${room.participants.length} participant${room.participants.length === 1 ? '' : 's'}</small><button id="dockVoiceTestButton" style="border:0;border-radius:6px;padding:8px 10px;background:#293957;color:#d6e5ff;font:700 10px Manrope;cursor:pointer">🎙 Voice test</button><small id="voiceTestStatus" style="display:block;color:#9fa8bc;margin:7px 0 10px">Record 5 seconds, then hear it back.</small><button id="disconnectVoice" style="border:0;border-radius:6px;padding:8px 10px;background:#4a2930;color:#ffd0cb;font:700 10px Manrope;cursor:pointer">Disconnect</button>`;
  const testButton = document.querySelector('#dockVoiceTestButton');
  testButton.onclick = () => startVoiceTest(testButton, document.querySelector('#voiceTestStatus'));
  document.querySelector('#disconnectVoice').onclick = async () => {
    stopVoiceTest();
    leaveLiveRoom();
    await api(`/api/channels/${roomChannel.id}/join`, { method: 'DELETE' });
    dock.remove();
    document.querySelectorAll(`[data-room-members="${roomChannel.id}"]`).forEach(node => node.remove());
  };
}

async function open(selectedChannel) {
  if (liveRoom && liveRoom.channelId !== selectedChannel.id) leaveLiveRoom();
  channel = selectedChannel;
  const kind = channelKind(channel);
  document.querySelector('#channelTitle').textContent = `${icons[kind] || '#'} ${channel.name}`;
  document.querySelector('#channelSubtitle').textContent = channel.description || community.name;
  document.querySelector('#channelType').textContent = titles[kind];
  if (['voice', 'auditorium'].includes(channel.type)) {
    form.hidden = true;
    messages.classList.remove('forum-view', 'gallery-view');
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
    messages.innerHTML = `<section class="live-room"><div class="live-room-head"><span>${channel.type === 'auditorium' ? 'AUDITORIUM' : 'VOICE ROOM'}</span><h2>${esc(channel.name)}</h2><p id="liveRoomStatus">Joining room signaling…</p></div><section id="roomVideoGrid" class="room-video-grid"><article id="localRoomTile" class="room-video-tile local"><video id="localRoomVideo" autoplay muted playsinline></video><span>You</span><em>Camera off</em></article></section><div class="live-room-actions"><button id="enableLiveMedia">Enable microphone & camera</button><button id="voiceTestButton">🎙 Voice test</button></div><p class="live-room-note">Your microphone and camera stay off until you choose to enable them. Browser permission is required.</p></section>`;
    document.querySelector('#enableLiveMedia').onclick = enableLiveMedia;
    const testButton = document.querySelector('#voiceTestButton');
    testButton.onclick = () => startVoiceTest(testButton, document.querySelector('#liveRoomStatus'));
    connectLiveRoom(channel);
    return;
  }
  if (kind === 'media') {
    form.hidden = true;
    await renderGallery();
    return;
  }
  form.hidden = false;
  const input = document.querySelector('#messageInput');
  const submit = form.querySelector('button');
  input.placeholder = kind === 'forum' ? 'Write the opening message for a new topic…' : 'Message this channel';
  submit.textContent = kind === 'forum' ? 'New Post' : 'Send';
  const result = await api(`/api/channels/${channel.id}/${channel.type === 'forum' ? 'forum-posts' : 'messages'}`);
  if (channel.type === 'forum') renderForum(result.posts); else render(result.messages);
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
  const membership = document.querySelector('#communityMembership');
  membership.innerHTML = '';
  if (community) {
    const membershipButton = document.createElement('button');
    membershipButton.className = 'membership-side-button';
    membershipButton.textContent = '✦ Membership';
    membershipButton.onclick = openMembership;
    membership.append(membershipButton);
  }
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
      button.textContent = `${icons[channelKind(channelItem)]} ${channelItem.name}`;
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

document.addEventListener('contextmenu', event => {
  if (event.defaultPrevented) return;
  if (event.target.closest('.community-side') && canEdit() && sidebar?.categories?.length) {
    contextMenu(event, categoryActions(sidebar.categories[0]));
    return;
  }
  if (event.target.matches('input,textarea')) {
    contextMenu(event, [{ label: 'Select All', action: () => event.target.select?.() }]);
    return;
  }
  contextMenu(event, [
    ...(channel ? [{ label: 'Refresh Current Channel', action: () => open(channel) }] : []),
    ...(canEdit() ? [{ label: 'Administration', action: () => showAdministration() }] : []),
    { label: 'Dashboard', action: () => location.assign('index.html') }
  ]);
});

document.querySelector('#channelModalCancel').onclick = () => channelModal.style.display = 'none';
channelModal.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  const name = document.querySelector('#channelModalName').value.trim();
  const selectedType = document.querySelector('#channelModalType').value;
  const type = selectedType === 'media' ? 'text' : selectedType;
  const displayMode = selectedType === 'media' ? 'gallery' : 'standard';
  const categoryId = Number(channelModal.dataset.category);
  if (!name) return;
  try {
    await api(`/api/communities/${community.id}/channels`, { method: 'POST', body: JSON.stringify({ name, type, displayMode, categoryId }) });
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
