const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];
const toast = $('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function showView(name) {
  $$('.view').forEach(view => view.classList.remove('active'));
  const target = $(`#${name}View`);
  if (!target) return;
  target.classList.add('active');
  $$('.rail-button').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('#heroJoin').addEventListener('click', () => showView('room'));
$('#joinLive').addEventListener('click', () => showView('room'));
$$('[data-join]').forEach(button => button.addEventListener('click', () => showView('room')));
$('#leaveLive').addEventListener('click', () => { showView('home'); showToast('You left Velvet’s live room.'); });

$$('.space').forEach(space => space.addEventListener('click', () => {
  $$('.space').forEach(item => item.classList.remove('selected'));
  space.classList.add('selected');
  showToast(`Opened ${space.innerText.trim()}`);
}));
$$('.channel').forEach(channel => channel.addEventListener('click', () => {
  if (channel.id === 'joinLive') return;
  $$('.channel').forEach(item => item.classList.remove('active'));
  channel.classList.add('active');
  showToast(`Switched to ${channel.textContent.trim()}`);
}));

$$('.panel-tabs button').forEach(button => button.addEventListener('click', () => {
  $$('.panel-tabs button').forEach(item => item.classList.remove('active'));
  $$('.panel-content').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  $(`#${button.dataset.panel}Panel`).classList.add('active');
}));

const intensity = $('#intensity');
intensity.addEventListener('input', () => { $('#intensityValue').value = `${intensity.value}%`; });
$$('.control-presets button').forEach(button => button.addEventListener('click', () => {
  intensity.value = button.dataset.intensity;
  intensity.dispatchEvent(new Event('input'));
  showToast(`Control set to ${button.textContent} (${intensity.value}%).`);
}));
$('#emergencyStop').addEventListener('click', () => {
  intensity.value = 0;
  intensity.dispatchEvent(new Event('input'));
  showToast('Emergency stop sent. All device controls are now at 0%.');
});
$('#disconnectDevice').addEventListener('click', event => {
  event.currentTarget.closest('.device-card').querySelector('small').textContent = 'Disconnected';
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = 'Disconnected';
  showToast('Universal device bridge disconnected.');
});

$('#chatForm').addEventListener('submit', event => {
  event.preventDefault();
  const input = $('#chatInput');
  const message = input.value.trim();
  if (!message) return;
  const row = document.createElement('div');
  row.className = 'message own';
  row.innerHTML = `<p><strong>Jordan</strong><small>now</small><br></p>`;
  row.querySelector('p').append(document.createTextNode(message));
  $('#messages').append(row);
  $('#messages').scrollTop = $('#messages').scrollHeight;
  input.value = '';
});

let muted = false;
$('#muteButton').addEventListener('click', event => {
  muted = !muted;
  event.currentTarget.innerHTML = muted ? '◉ <span>Unmute</span>' : '◉ <span>Mute</span>';
  showToast(muted ? 'Room audio muted.' : 'Room audio on.');
});
$('#cameraButton').addEventListener('click', () => showToast('Your camera stays private until you choose to share it.'));
$('#fullScreen').addEventListener('click', () => {
  const stage = $('.stream-stage');
  if (stage.requestFullscreen) stage.requestFullscreen();
});
$('#tipButton').addEventListener('click', () => showToast('Tips are enabled in the connected payment experience.'));
$('#shareRoom').addEventListener('click', () => showToast('Private room link copied (demo).'));

const modal = $('#modalBackdrop');
function openModal() { modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); }
function closeModal() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
['upgradeButton', 'discoverUpgrade', 'manageMembership'].forEach(id => $(`#${id}`).addEventListener('click', openModal));
$('#closeModal').addEventListener('click', closeModal);
modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
$$('.plan').forEach(plan => plan.addEventListener('click', () => { $$('.plan').forEach(item => item.classList.remove('selected')); plan.classList.add('selected'); }));
$('#confirmUpgrade').addEventListener('click', () => { closeModal(); showToast('Membership setup would continue through your approved payment partner.'); });

$('#newRoom').addEventListener('click', () => showToast('Creator room setup is available to verified performer accounts.'));
$('#settings').addEventListener('click', () => showView('profile'));
$('#searchRooms').addEventListener('input', event => {
  const query = event.target.value.toLowerCase();
  $$('.space').forEach(space => { space.style.display = space.textContent.toLowerCase().includes(query) ? '' : 'none'; });
});
$$('.heart').forEach(button => button.addEventListener('click', () => { button.textContent = button.textContent === '♡' ? '♥' : '♡'; showToast('Saved to your library.'); }));
$$('.filter').forEach(button => button.addEventListener('click', () => { $$('.filter').forEach(item => item.classList.remove('active')); button.classList.add('active'); }));
