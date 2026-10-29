const audio = document.querySelector('#audio');
const list = document.querySelector('#track-list');
const filter = document.querySelector('#filter');
const playButton = document.querySelector('#toggle-play');
let tracks = [];
let visibleTracks = [];
let currentIndex = -1;
let shuffle = false;
let repeat = false;
const playlistStorageKey = 'ceedeefy.playlists.v1';
let playlists = loadPlaylists();
let activeQueue = [];
let queuePosition = -1;

function loadPlaylists() {
  try {
    const saved = JSON.parse(localStorage.getItem(playlistStorageKey) || '[]');
    return Array.isArray(saved) ? saved.filter(p => p && typeof p.name === 'string' && Array.isArray(p.tracks)).map(p => ({id:String(p.id), name:p.name, tracks:p.tracks.filter(id => typeof id === 'string')})) : [];
  } catch { return []; }
}

function savePlaylists() { localStorage.setItem(playlistStorageKey, JSON.stringify(playlists)); }

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

let viewingPlaylist = null;
let activeQueuePlaylist = null;

function showAllSongs() {
  viewingPlaylist = null; filter.value = ''; visibleTracks = tracks;
  document.querySelector('#all-songs').classList.add('active'); renderPlaylists(); renderTracks();
}

function showPlaylist(playlist) {
  if (!playlist) return;
  viewingPlaylist = playlist.id; document.querySelector('#all-songs').classList.remove('active');
  renderPlaylists();
  const ids = new Set(playlist.tracks); visibleTracks = tracks.filter(track => ids.has(track.id));
  document.querySelector('#track-count').textContent = visibleTracks.length;
  document.querySelector('.songs-section h2').firstChild.textContent = `${playlist.name} `;
  document.querySelector('#empty-library').hidden = true;
  if (!visibleTracks.length) list.innerHTML = '<tr><td colspan="4" class="empty-state">This playlist is empty. Add songs with the + button.</td></tr>';
  else renderTracks();
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

async function loadLibrary() {
  document.querySelector('#connection-status').textContent = 'Connecting to library';
  try {
    const response = await fetch('/api/tracks', {cache:'no-store'});
    if (!response.ok) throw new Error(`Library returned ${response.status}`);
    tracks = await response.json(); visibleTracks = tracks;
    document.querySelector('#connection-status').textContent = `${tracks.length} songs ready`;
    document.querySelector('.status-dot').classList.remove('offline');
    document.querySelector('#sidebar-count').textContent = `${tracks.length} songs`;
    renderTracks();
  } catch (error) {
    document.querySelector('#connection-status').textContent = 'Library unavailable';
    document.querySelector('.status-dot').classList.add('offline');
    document.querySelector('#track-count').textContent = '—';
    list.innerHTML = `<tr><td colspan="4" class="empty-state">Couldn’t reach the library.<br><small>${escapeHtml(error.message)}</small></td></tr>`;
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
    return `<tr class="track-row ${active?'selected':''}" data-index="${originalIndex}" tabindex="0" aria-label="Play ${escapeHtml(track.title)} by ${escapeHtml(track.artist)}">
      <td class="song-number">${active && !audio.paused ? '♫' : String(index+1).padStart(2,'0')}</td>
      <td><div class="song-title-cell"><span class="mini-cover" style="${coverStyle(originalIndex)}">♫</span><span class="song-copy"><span class="song-title">${escapeHtml(track.title)}</span><span class="song-artist">${escapeHtml(track.artist)}</span></span><button class="add-track" aria-label="${inPlaylist ? 'Remove' : 'Add'} ${escapeHtml(track.title)} ${inPlaylist ? 'from' : 'to'} playlist" title="${inPlaylist ? 'Remove from playlist' : 'Add to playlist'}">${inPlaylist ? '−' : '＋'}</button></div></td>
      <td class="album-cell">${escapeHtml(track.album)}</td><td class="duration-cell">${formatTime(track.duration)}</td></tr>`;
  }).join('');
  list.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', () => playTrack(Number(row.dataset.index)));
    row.addEventListener('keydown', event => { if (event.key === 'Enter') playTrack(Number(row.dataset.index)); });
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
  document.querySelector('#current-art').style = coverStyle(index);
  document.querySelector('#current-art').textContent = '♫';
  renderTracks();
  try { await audio.play(); } catch (error) { document.querySelector('#connection-status').textContent = 'Couldn’t play this song'; console.error('Playback failed:', error); }
}

function stepTrack(direction) {
  const queue = activeQueue.length ? activeQueue : tracks.map((_, index) => index);
  if (!queue.length) return;
  if (shuffle && queue.length > 1) { let next = currentIndex; while (next === currentIndex) next = queue[Math.floor(Math.random()*queue.length)]; playTrack(next); }
  else {
    const position = queue.indexOf(currentIndex);
    const nextPosition = position < 0 ? 0 : (position + direction + queue.length) % queue.length;
    queuePosition = nextPosition; playTrack(queue[nextPosition]);
  }
}

function playPlaylist(playlist) {
  if (!playlist) return;
  const ids = new Set(playlist.tracks); activeQueue = tracks.map((track,index) => ids.has(track.id) ? index : -1).filter(index => index >= 0);
  activeQueuePlaylist = playlist.id;
  if (!activeQueue.length) { showPlaylist(playlist); return; }
  queuePosition = 0; playTrack(activeQueue[0]);
}

filter.addEventListener('input', () => { viewingPlaylist = null; document.querySelector('#all-songs').classList.add('active'); document.querySelector('.songs-section h2').firstChild.textContent='All songs '; const q = filter.value.trim().toLowerCase(); visibleTracks = tracks.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)); renderTracks(); });
document.querySelector('#play-all').addEventListener('click', () => playTrack(currentIndex >= 0 ? currentIndex : 0));
document.querySelector('#all-songs').addEventListener('click', () => { showAllSongs(); document.querySelector('.songs-section h2').firstChild.textContent='All songs '; });
document.querySelector('#refresh').addEventListener('click', loadLibrary);
document.querySelector('#search-link').addEventListener('click', () => setTimeout(() => filter.focus(), 0));
document.querySelector('#toggle-play').addEventListener('click', async () => {
  if (currentIndex < 0) return playTrack(0);
  if (audio.paused) { try { await audio.play(); } catch (error) { console.error(error); } } else audio.pause();
});
document.querySelector('#previous').addEventListener('click', () => { if (audio.currentTime > 3) audio.currentTime=0; else stepTrack(-1); });
document.querySelector('#next').addEventListener('click', () => stepTrack(1));
document.querySelector('#shuffle').addEventListener('click', event => { shuffle=!shuffle; event.currentTarget.classList.toggle('active',shuffle); });
document.querySelector('#repeat').addEventListener('click', event => { repeat=!repeat; audio.loop=repeat; event.currentTarget.classList.toggle('active',repeat); });
document.querySelector('#volume').addEventListener('input', event => { audio.volume=Number(event.target.value); });
document.querySelector('#seek').addEventListener('input', event => { if(Number.isFinite(audio.duration)) audio.currentTime=(Number(event.target.value)/1000)*audio.duration; });
audio.volume=.8;
audio.addEventListener('play', () => { document.querySelector('.welcome-art').classList.add('is-playing'); playButton.textContent='Ⅱ'; playButton.setAttribute('aria-label','Pause'); renderTracks(); });
audio.addEventListener('pause', () => { document.querySelector('.welcome-art').classList.remove('is-playing'); playButton.textContent='▶'; playButton.setAttribute('aria-label','Play'); renderTracks(); });
audio.addEventListener('loadedmetadata', () => { if(tracks[currentIndex]) tracks[currentIndex].duration=audio.duration; document.querySelector('#remaining').textContent=formatTime(audio.duration); renderTracks(); });
audio.addEventListener('timeupdate', () => { document.querySelector('#elapsed').textContent=formatTime(audio.currentTime); document.querySelector('#remaining').textContent=formatTime(audio.duration); document.querySelector('#seek').value=Number.isFinite(audio.duration)&&audio.duration>0?String(Math.round(audio.currentTime/audio.duration*1000)):'0'; });
audio.addEventListener('ended', () => { if(!repeat) stepTrack(1); });
document.addEventListener('keydown', event => { if(event.key==='/'&&document.activeElement!==filter){event.preventDefault();filter.focus();} if(event.code==='Space'&&document.activeElement!==filter&&currentIndex>=0){event.preventDefault();playButton.click();} });
renderPlaylists();
loadLibrary();
