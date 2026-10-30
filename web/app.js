const audio = document.querySelector('#audio');
const list = document.querySelector('#track-list');
const filter = document.querySelector('#filter');
const sortSelect = document.querySelector('#sort-select');
const playButton = document.querySelector('#toggle-play');
let tracks = [];
let visibleTracks = [];
let currentIndex = -1;
let shuffle = false;
let repeatMode = 'off';
let sortMode = 'artist';
const legacyPlaylistStorageKey = 'ceedeefy.playlists.v1';
const playbackStorageKey = 'ceedeefy.playback.v1';
let lastPlaybackSave = 0;
let playlists = [];
let playlistSaveQueue = Promise.resolve();
let playlistSavePending = 0;
let activeQueue = [];
let queuePosition = -1;

function setQueueFromVisibleTracks() {
  activeQueue = visibleTracks.map(track => tracks.indexOf(track)).filter(index => index >= 0);
  queuePosition = activeQueue.indexOf(currentIndex);
  activeQueuePlaylist = viewingPlaylist;
}

function loadLegacyPlaylists() {
  try {
    const saved = JSON.parse(localStorage.getItem(legacyPlaylistStorageKey) || '[]');
    return Array.isArray(saved) ? saved.filter(p => p && typeof p.name === 'string' && Array.isArray(p.tracks)).map(p => ({id:String(p.id), name:p.name, tracks:p.tracks.filter(id => typeof id === 'string')})) : [];
  } catch { return []; }
}

function savePlaylists() {
  const snapshot = JSON.stringify(playlists);
  try { localStorage.setItem(legacyPlaylistStorageKey, snapshot); } catch { /* Server storage remains authoritative. */ }
  playlistSavePending++;
  playlistSaveQueue = playlistSaveQueue.then(async () => {
    const response = await fetch('/api/playlists', {method:'PUT', headers:{'Content-Type':'application/json'}, body:snapshot});
    if (!response.ok) throw new Error(`Playlist server returned ${response.status}`);
    try { localStorage.removeItem(legacyPlaylistStorageKey); } catch { /* Ignore unavailable browser storage. */ }
  }).catch(error => {
    document.querySelector('#connection-status').textContent = 'Playlist changes could not be synced';
    console.error('Playlist sync failed:', error);
  }).finally(() => { playlistSavePending--; });
  return playlistSaveQueue;
}

async function refreshSharedPlaylists(initial = false) {
  if (playlistSavePending) return;
  try {
    const response = await fetch('/api/playlists', {cache:'no-store'});
    if (!response.ok) throw new Error(`Playlist server returned ${response.status}`);
    const saved = await response.json();
    if (saved === null && !initial) return;
    if (initial) {
      const legacy = loadLegacyPlaylists();
      if (legacy.length) {
        const knownIds = new Set((Array.isArray(saved) ? saved : []).map(playlist => playlist.id));
        playlists = [...(Array.isArray(saved) ? saved : []), ...legacy.filter(playlist => !knownIds.has(playlist.id))];
        renderPlaylists();
        await savePlaylists();
        return;
      }
    }
    if (saved === null) {
      playlists = [];
      renderPlaylists();
      await savePlaylists();
      return;
    }
    const next = Array.isArray(saved) ? saved : [];
    if (JSON.stringify(next) !== JSON.stringify(playlists)) {
      playlists = next;
      renderPlaylists();
      if (viewingPlaylist) {
        const active = playlists.find(playlist => playlist.id === viewingPlaylist);
        if (active) showPlaylist(active); else showAllSongs();
      }
    }
    try { localStorage.removeItem(legacyPlaylistStorageKey); } catch { /* Ignore unavailable browser storage. */ }
  } catch (error) {
    if (initial) {
      playlists = loadLegacyPlaylists();
      renderPlaylists();
    }
    console.error('Could not load shared playlists:', error);
  }
}

function renderPlaylists() {
  const container = document.querySelector('#playlist-list');
  container.innerHTML = playlists.map(playlist => `<div class="playlist-item ${viewingPlaylist === playlist.id ? 'active' : ''}" data-playlist="${escapeHtml(playlist.id)}"><button class="playlist-select" title="Show playlist"><span class="playlist-symbol">♫</span><span class="playlist-name">${escapeHtml(playlist.name)}</span><small>${playlist.tracks.length}</small></button><button class="playlist-play" aria-label="Play ${escapeHtml(playlist.name)}" title="Play playlist">▶</button><button class="playlist-delete" aria-label="Delete ${escapeHtml(playlist.name)}" title="Delete playlist">×</button></div>`).join('');
  container.querySelectorAll('.playlist-item').forEach(row => {
    const playlist = playlists.find(item => item.id === row.dataset.playlist);
    row.querySelector('.playlist-select').addEventListener('click', () => showPlaylist(playlist));
    row.querySelector('.playlist-play').addEventListener('click', () => playPlaylist(playlist));
    row.querySelector('.playlist-delete').addEventListener('click', () => {
      if (!confirm(`Delete “${playlist.name}”?`)) return;
      playlists = playlists.filter(item => item.id !== playlist.id);
      savePlaylists(); renderPlaylists();
      if (activeQueuePlaylist === playlist.id) { activeQueue = []; activeQueuePlaylist = null; }
      if (viewingPlaylist === playlist.id) showAllSongs();
    });
  });
  const mobile = document.querySelector('#mobile-playlist-list');
  mobile.innerHTML = playlists.map(playlist => `<button class="mobile-playlist" data-playlist="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)} <small>${playlist.tracks.length}</small></button>`).join('');
  document.querySelector('#mobile-playlists').hidden = false;
  mobile.querySelectorAll('.mobile-playlist').forEach(button => button.addEventListener('click', () => {
    const playlist = playlists.find(item => item.id === button.dataset.playlist);
    if (playlist) playPlaylist(playlist);
  }));
}

function renderArtists() {
  const groups = new Map();
  tracks.forEach((track, index) => {
    const artist = track.artist.trim() || 'Unknown artist';
    if (!groups.has(artist)) groups.set(artist, []);
    groups.get(artist).push({track, index});
  });
  const artists = [...groups.entries()]
    .filter(([, songs]) => songs.length > 2)
    .sort(([a], [b]) => trackCollator.compare(a, b));
  const container = document.querySelector('#artist-list');
  document.querySelector('#artist-count').textContent = artists.length;
  container.innerHTML = artists.map(([artist, songs]) => {
    const active = viewingArtist === artist;
    return `<section class="artist-item ${active ? 'active' : ''}">
      <div class="artist-row">
      <button class="artist-select" data-artist="${escapeHtml(artist)}" title="Show ${escapeHtml(artist)} songs">
        <span class="artist-avatar" aria-hidden="true">${escapeHtml(artist.charAt(0).toUpperCase())}</span>
        <span class="artist-name">${escapeHtml(artist)}</span><small>${songs.length}</small>
      </button>
      <button class="artist-play" data-artist="${escapeHtml(artist)}" aria-label="Play ${escapeHtml(artist)}" title="Play artist">▶</button>
      </div>
    </section>`;
  }).join('');
  container.querySelectorAll('.artist-select').forEach(button => button.addEventListener('click', () => showArtist(button.dataset.artist)));
  container.querySelectorAll('.artist-play').forEach(button => button.addEventListener('click', () => playArtist(button.dataset.artist)));
}

let viewingPlaylist = null;
let activeQueuePlaylist = null;
let viewingArtist = null;

function showAllSongs() {
  viewingPlaylist = null; viewingArtist = null; filter.value = ''; visibleTracks = sortTracks(tracks);
  setQueueFromVisibleTracks();
  document.querySelector('.songs-section h2').firstChild.textContent = 'All songs ';
  document.querySelector('#all-songs').classList.add('active'); renderPlaylists(); renderTracks();
  renderArtists();
}

function showPlaylist(playlist) {
  if (!playlist) return;
  viewingPlaylist = playlist.id; viewingArtist = null; document.querySelector('#all-songs').classList.remove('active'); renderArtists();
  renderPlaylists();
  const ids = new Set(playlist.tracks); visibleTracks = sortTracks(tracks.filter(track => ids.has(track.id)));
  setQueueFromVisibleTracks();
  document.querySelector('#track-count').textContent = visibleTracks.length;
  document.querySelector('.songs-section h2').firstChild.textContent = `${playlist.name} `;
  document.querySelector('#empty-library').hidden = true;
  if (!visibleTracks.length) list.innerHTML = '<tr><td colspan="5" class="empty-state">This playlist is empty. Add songs with the + button.</td></tr>';
  else renderTracks();
}

function showArtist(artist) {
  viewingPlaylist = null; viewingArtist = artist; filter.value = '';
  document.querySelector('#all-songs').classList.remove('active');
  const matching = tracks.filter(track => (track.artist.trim() || 'Unknown artist') === artist);
  visibleTracks = sortTracks(matching);
  setQueueFromVisibleTracks();
  document.querySelector('.songs-section h2').firstChild.textContent = `${artist} `;
  document.querySelector('#empty-library').hidden = true;
  renderArtists(); renderTracks();
}

function playArtist(artist) {
  activeQueue = tracks.map((track, index) => (track.artist.trim() || 'Unknown artist') === artist ? index : -1).filter(index => index >= 0);
  activeQueuePlaylist = null;
  if (!activeQueue.length) return;
  showArtist(artist);
  setQueueFromVisibleTracks();
  queuePosition = 0;
  playTrack(activeQueue[0]);
}

document.querySelector('#create-playlist').addEventListener('click', () => {
  const name = prompt('Name your playlist');
  if (!name || !name.trim()) return;
  playlists.push({id:crypto.randomUUID(), name:name.trim(), tracks:[]});
  savePlaylists(); renderPlaylists();
});
document.querySelector('#mobile-create-playlist').addEventListener('click', () => document.querySelector('#create-playlist').click());

function addToPlaylist(track) {
  if (!playlists.length) { alert('Create a playlist first.'); return; }
  const choice = prompt(`Add “${track.title}” to which playlist?\n${playlists.map((p,i) => `${i+1}. ${p.name}`).join('\n')}\nEnter a number:`);
  const playlist = playlists[Number(choice)-1];
  if (!playlist) return;
  if (!playlist.tracks.includes(track.id)) playlist.tracks.push(track.id);
  savePlaylists(); renderPlaylists();
  if (viewingPlaylist === playlist.id) showPlaylist(playlist);
}

const palette = [['#e1d1a6','#897252'],['#d6d88c','#677849'],['#d3a991','#795b4d'],['#a6c4b6','#506c60'],['#c4acd2','#685579'],['#d3b2bb','#835c65']];
const formatTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '0:00';
const coverStyle = index => { const [a,b] = palette[index % palette.length]; return `background:linear-gradient(145deg,${a},${b})`; };
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const trackCollator = new Intl.Collator(undefined, {numeric:true, sensitivity:'base'});

function sortTracks(items) {
  return [...items].sort((a, b) => {
    if (sortMode === 'title') return trackCollator.compare(a.title, b.title) || trackCollator.compare(a.artist, b.artist);
    if (sortMode === 'created') {
      const dateDifference = (Number.isFinite(b.created_at) ? b.created_at : -1) - (Number.isFinite(a.created_at) ? a.created_at : -1);
      if (dateDifference) return dateDifference;
    }
    return trackCollator.compare(a.artist, b.artist) || trackCollator.compare(a.title, b.title);
  });
}

async function loadLibrary() {
  document.querySelector('#connection-status').textContent = 'Connecting to library';
  try {
    const response = await fetch('/api/tracks', {cache:'no-store'});
    if (!response.ok) throw new Error(`Library returned ${response.status}`);
    tracks = await response.json(); visibleTracks = sortTracks(tracks);
    document.querySelector('#connection-status').textContent = `${tracks.length} songs ready`;
    document.querySelector('.status-dot').classList.remove('offline');
    document.querySelector('#sidebar-count').textContent = `${tracks.length} songs`;
    renderTracks(); renderArtists();
    await restorePlayback();
  } catch (error) {
    document.querySelector('#connection-status').textContent = 'Library unavailable';
    document.querySelector('.status-dot').classList.add('offline');
    document.querySelector('#track-count').textContent = '—';
    list.innerHTML = `<tr><td colspan="5" class="empty-state">Couldn’t reach the library.<br><small>${escapeHtml(error.message)}</small></td></tr>`;
    document.querySelector('#empty-library').hidden = true;
  }
}

function renderTracks() {
  document.querySelector('#track-count').textContent = visibleTracks.length;
  document.querySelector('#empty-library').hidden = visibleTracks.length > 0;
  if (!visibleTracks.length) { list.innerHTML = ''; return; }
  list.innerHTML = visibleTracks.map((track, index) => {
    const originalIndex = tracks.indexOf(track), active = originalIndex === currentIndex;
    const inPlaylist = viewingPlaylist !== null;
    const coverImage = track.artwork_url ? `<img class="cover-image" src="${escapeHtml(track.artwork_url)}" alt="" loading="lazy" onerror="this.remove()" />` : '';
    return `<tr class="track-row ${active?'selected':''}" data-index="${originalIndex}" tabindex="0" aria-label="Play ${escapeHtml(track.title)} by ${escapeHtml(track.artist)}">
      <td class="song-number">${active && !audio.paused ? '♫' : String(index+1).padStart(2,'0')}</td>
      <td><div class="song-title-cell"><span class="mini-cover" style="${coverStyle(originalIndex)}">♫${coverImage}</span><span class="song-copy"><span class="song-title">${escapeHtml(track.title)}</span><span class="song-artist">${escapeHtml(track.artist)}</span></span><button class="add-track" aria-label="${inPlaylist ? 'Remove' : 'Add'} ${escapeHtml(track.title)} ${inPlaylist ? 'from' : 'to'} playlist" title="${inPlaylist ? 'Remove from playlist' : 'Add to playlist'}">${inPlaylist ? '−' : '＋'}</button></div></td>
      <td class="album-cell">${escapeHtml(track.album)}</td><td class="quality-cell">${track.bitrate_kbps ? `${track.bitrate_kbps} kbps` : '—'}</td><td class="duration-cell">${formatTime(track.duration)}</td></tr>`;
  }).join('');
  list.querySelectorAll('.cover-image').forEach(image => image.addEventListener('error', () => image.remove(), {once:true}));
  list.querySelectorAll('.track-row').forEach(row => {
    const selectTrack = () => {
      const index = Number(row.dataset.index);
      if (!activeQueue.includes(index)) setQueueFromVisibleTracks();
      queuePosition = activeQueue.indexOf(index);
      playTrack(index);
    };
    row.addEventListener('click', selectTrack);
    row.addEventListener('keydown', event => { if (event.key === 'Enter') selectTrack(); });
    row.querySelector('.add-track').addEventListener('click', event => {
      event.stopPropagation();
      const track = tracks[Number(row.dataset.index)];
      if (viewingPlaylist) {
        const playlist = playlists.find(item => item.id === viewingPlaylist);
        if (playlist) { playlist.tracks = playlist.tracks.filter(id => id !== track.id); savePlaylists(); renderPlaylists(); showPlaylist(playlist); }
      } else addToPlaylist(track);
    });
  });
}

async function playTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  if (activeQueue.length && !activeQueue.includes(index)) { activeQueue = []; activeQueuePlaylist = null; }
  const track = tracks[index]; audio.src = track.src;
  document.querySelector('#current-title').textContent = track.title;
  document.querySelector('#current-artist').textContent = track.artist;
  const currentArt = document.querySelector('#current-art');
  currentArt.style = coverStyle(index);
  currentArt.textContent = '♫';
  if (track.artwork_url) {
    const image = document.createElement('img');
    image.className = 'cover-image';
    image.alt = `${track.album} album art`;
    image.src = track.artwork_url;
    image.addEventListener('error', () => image.remove(), {once:true});
    currentArt.append(image);
  }
  renderTracks();
  try { await audio.play(); } catch (error) { document.querySelector('#connection-status').textContent = 'Couldn’t play this song'; console.error('Playback failed:', error); }
}

function savePlaybackState(force = false) {
  if (currentIndex < 0 || !tracks[currentIndex]) return;
  const now = Date.now();
  if (!force && now - lastPlaybackSave < 1000 && !audio.paused) return;
  lastPlaybackSave = now;
  try {
    localStorage.setItem(playbackStorageKey, JSON.stringify({
      trackId: tracks[currentIndex].id,
      src: tracks[currentIndex].src,
      time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      wasPlaying: !audio.paused
    }));
  } catch (error) { console.warn('Could not save playback position:', error); }
}

async function restorePlayback() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(playbackStorageKey) || 'null'); } catch { return; }
  if (!saved || typeof saved !== 'object') return;
  const index = tracks.findIndex(track => (saved.trackId && track.id === saved.trackId) || (!saved.trackId && track.src === saved.src));
  if (index < 0) return;
  const track = tracks[index];
  currentIndex = index;
  audio.src = track.src;
  document.querySelector('#current-title').textContent = track.title;
  document.querySelector('#current-artist').textContent = track.artist;
  const currentArt = document.querySelector('#current-art');
  currentArt.style = coverStyle(index);
  currentArt.textContent = '♫';
  if (track.artwork_url) {
    const image = document.createElement('img');
    image.className = 'cover-image'; image.alt = `${track.album} album art`; image.src = track.artwork_url;
    image.addEventListener('error', () => image.remove(), {once:true});
    currentArt.append(image);
  }
  renderTracks();
  await new Promise(resolve => {
    if (audio.readyState >= 1) return resolve();
    audio.addEventListener('loadedmetadata', resolve, {once:true});
    audio.addEventListener('error', resolve, {once:true});
    audio.load();
  });
  if (Number.isFinite(saved.time) && Number.isFinite(audio.duration)) audio.currentTime = Math.min(Math.max(0, saved.time), audio.duration);
  if (saved.wasPlaying) {
    try { await audio.play(); } catch { /* Browser autoplay policy may require the user to press Play. */ }
  }
}

function stepTrack(direction) {
  const queue = activeQueue.length ? activeQueue : tracks.map((_, index) => index);
  if (!queue.length) return;
  const position = queue.indexOf(currentIndex);
  const currentPosition = position < 0 ? 0 : position;
  let nextPosition = currentPosition + direction;
  if (repeatMode === 'all') nextPosition = (nextPosition + queue.length) % queue.length;
  else if (nextPosition < 0 || nextPosition >= queue.length) return;
  queuePosition = nextPosition;
  playTrack(queue[nextPosition]);
}

function updateRepeatControl() {
  const button = document.querySelector('#repeat');
  button.classList.toggle('active', repeatMode !== 'off');
  button.textContent = repeatMode === 'one' ? '↻¹' : '↻';
  button.setAttribute('aria-label', repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat list' : 'Repeat current song');
  button.title = repeatMode === 'off' ? 'Repeat off' : repeatMode === 'all' ? 'Repeat list' : 'Repeat current song';
}

function playPlaylist(playlist) {
  if (!playlist) return;
  showPlaylist(playlist);
  const ids = new Set(playlist.tracks); activeQueue = tracks.map((track,index) => ids.has(track.id) ? index : -1).filter(index => index >= 0);
  activeQueuePlaylist = playlist.id;
  if (!activeQueue.length) return;
  queuePosition = 0; playTrack(activeQueue[0]);
}

filter.addEventListener('input', () => { viewingPlaylist = null; viewingArtist = null; document.querySelector('#all-songs').classList.add('active'); document.querySelector('.songs-section h2').firstChild.textContent='All songs '; const q = filter.value.trim().toLowerCase(); visibleTracks = sortTracks(tracks.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q))); setQueueFromVisibleTracks(); renderArtists(); renderTracks(); });
sortSelect.addEventListener('change', () => { sortMode = sortSelect.value; visibleTracks = sortTracks(visibleTracks); setQueueFromVisibleTracks(); renderTracks(); });
document.querySelector('#play-all').addEventListener('click', () => {
  setQueueFromVisibleTracks();
  if (!activeQueue.length) return;
  const index = activeQueue.includes(currentIndex) ? currentIndex : activeQueue[0];
  queuePosition = activeQueue.indexOf(index);
  playTrack(index);
});
document.querySelector('#all-songs').addEventListener('click', showAllSongs);
document.querySelector('#refresh').addEventListener('click', () => {
  loadLibrary();
  refreshSharedPlaylists();
});
document.querySelector('#artists-toggle').addEventListener('click', event => {
  const button = event.currentTarget;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  document.querySelector('#artist-list').hidden = expanded;
});
const menuToggle = document.querySelector('#menu-toggle');
const sidebarBackdrop = document.querySelector('#sidebar-backdrop');
function setMobileMenuOpen(open) {
  const wasOpen = document.body.classList.contains('mobile-menu-open');
  document.body.classList.toggle('mobile-menu-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  if (!open && wasOpen) menuToggle.focus();
}
menuToggle.addEventListener('click', () => setMobileMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true'));
sidebarBackdrop.addEventListener('click', () => setMobileMenuOpen(false));
document.querySelectorAll('.sidebar .nav-link, .sidebar .brand, .sidebar #all-songs').forEach(link => {
  link.addEventListener('click', () => setMobileMenuOpen(false));
});
document.querySelector('#toggle-play').addEventListener('click', async () => {
  if (currentIndex < 0) return playTrack(0);
  if (audio.paused) { try { await audio.play(); } catch (error) { console.error(error); } } else audio.pause();
});
document.querySelector('#previous').addEventListener('click', () => { if (audio.currentTime > 3) audio.currentTime=0; else stepTrack(-1); });
document.querySelector('#next').addEventListener('click', () => stepTrack(1));
document.querySelector('#shuffle').addEventListener('click', event => {
  shuffle = !shuffle;
  if (shuffle) {
    if (!activeQueue.length) setQueueFromVisibleTracks();
    const currentPosition = activeQueue.indexOf(currentIndex);
    if (currentPosition > 0) activeQueue.splice(0, 0, ...activeQueue.splice(currentPosition, 1));
    const shuffleStart = currentPosition >= 0 ? 1 : 0;
    for (let index = activeQueue.length - 1; index > shuffleStart; index--) {
      const randomIndex = shuffleStart + Math.floor(Math.random() * (index - shuffleStart + 1));
      [activeQueue[index], activeQueue[randomIndex]] = [activeQueue[randomIndex], activeQueue[index]];
    }
  } else {
    setQueueFromVisibleTracks();
  }
  queuePosition = activeQueue.indexOf(currentIndex);
  event.currentTarget.classList.toggle('active', shuffle);
  event.currentTarget.setAttribute('aria-label', shuffle ? 'Random on' : 'Random off');
  event.currentTarget.title = shuffle ? 'Random on' : 'Random off';
});
document.querySelector('#repeat').addEventListener('click', () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  updateRepeatControl();
});
updateRepeatControl();
document.querySelector('#volume').addEventListener('input', event => { audio.volume=Number(event.target.value); });
document.querySelector('#seek').addEventListener('input', event => { if(Number.isFinite(audio.duration)) audio.currentTime=(Number(event.target.value)/1000)*audio.duration; });
audio.volume=.8;
audio.addEventListener('play', () => { document.querySelector('.welcome-art').classList.add('is-playing'); playButton.textContent='Ⅱ'; playButton.setAttribute('aria-label','Pause'); renderTracks(); savePlaybackState(); });
audio.addEventListener('pause', () => { document.querySelector('.welcome-art').classList.remove('is-playing'); playButton.textContent='▶'; playButton.setAttribute('aria-label','Play'); renderTracks(); savePlaybackState(true); });
audio.addEventListener('loadedmetadata', () => { if(tracks[currentIndex]) tracks[currentIndex].duration=audio.duration; document.querySelector('#remaining').textContent=formatTime(audio.duration); renderTracks(); });
audio.addEventListener('timeupdate', () => { document.querySelector('#elapsed').textContent=formatTime(audio.currentTime); document.querySelector('#remaining').textContent=formatTime(audio.duration); document.querySelector('#seek').value=Number.isFinite(audio.duration)&&audio.duration>0?String(Math.round(audio.currentTime/audio.duration*1000)):'0'; savePlaybackState(); });
audio.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play().catch(error => console.error('Could not repeat this song:', error));
  } else {
    stepTrack(1);
  }
});
window.addEventListener('pagehide', () => savePlaybackState(true));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('mobile-menu-open')) setMobileMenuOpen(false);
  if(event.key==='/'&&document.activeElement!==filter){event.preventDefault();filter.focus();}
  if(event.code==='Space'&&document.activeElement!==filter&&currentIndex>=0){event.preventDefault();playButton.click();}
});
renderPlaylists();
loadLibrary();
refreshSharedPlaylists(true);
