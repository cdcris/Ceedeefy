const audio = document.querySelector('#audio');
const list = document.querySelector('#track-list');
const filter = document.querySelector('#filter');
const playButton = document.querySelector('#toggle-play');
let tracks = [];
let visibleTracks = [];
let currentIndex = -1;
let shuffle = false;
let repeat = false;

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
    return `<tr class="track-row ${active?'selected':''}" data-index="${originalIndex}" tabindex="0" aria-label="Play ${escapeHtml(track.title)} by ${escapeHtml(track.artist)}">
      <td class="song-number">${active && !audio.paused ? '♫' : String(index+1).padStart(2,'0')}</td>
      <td><div class="song-title-cell"><span class="mini-cover" style="${coverStyle(originalIndex)}">♫</span><span><span class="song-title">${escapeHtml(track.title)}</span><span class="song-artist">${escapeHtml(track.artist)}</span></span></div></td>
      <td class="album-cell">${escapeHtml(track.album)}</td><td class="duration-cell">${formatTime(track.duration)}</td></tr>`;
  }).join('');
  list.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', () => playTrack(Number(row.dataset.index)));
    row.addEventListener('keydown', event => { if (event.key === 'Enter') playTrack(Number(row.dataset.index)); });
  });
}

async function playTrack(index) {
  if (!tracks[index]) return;
  currentIndex = index;
  const track = tracks[index]; audio.src = track.src;
  document.querySelector('#current-title').textContent = track.title;
  document.querySelector('#current-artist').textContent = track.artist;
  document.querySelector('#current-art').style = coverStyle(index);
  document.querySelector('#current-art').textContent = '♫';
  renderTracks();
  try { await audio.play(); } catch (error) { document.querySelector('#connection-status').textContent = 'Couldn’t play this song'; console.error('Playback failed:', error); }
}

function stepTrack(direction) {
  if (!tracks.length) return;
  if (shuffle && tracks.length > 1) { let next = currentIndex; while (next === currentIndex) next = Math.floor(Math.random()*tracks.length); playTrack(next); }
  else playTrack(currentIndex < 0 ? 0 : (currentIndex + direction + tracks.length) % tracks.length);
}

filter.addEventListener('input', () => { const q = filter.value.trim().toLowerCase(); visibleTracks = tracks.filter(t => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)); renderTracks(); });
document.querySelector('#play-all').addEventListener('click', () => playTrack(currentIndex >= 0 ? currentIndex : 0));
document.querySelector('#all-songs').addEventListener('click', () => { filter.value=''; visibleTracks=tracks; renderTracks(); });
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
audio.addEventListener('play', () => { playButton.textContent='Ⅱ'; playButton.setAttribute('aria-label','Pause'); renderTracks(); });
audio.addEventListener('pause', () => { playButton.textContent='▶'; playButton.setAttribute('aria-label','Play'); renderTracks(); });
audio.addEventListener('loadedmetadata', () => { if(tracks[currentIndex]) tracks[currentIndex].duration=audio.duration; document.querySelector('#remaining').textContent=formatTime(audio.duration); renderTracks(); });
audio.addEventListener('timeupdate', () => { document.querySelector('#elapsed').textContent=formatTime(audio.currentTime); document.querySelector('#remaining').textContent=formatTime(audio.duration); document.querySelector('#seek').value=Number.isFinite(audio.duration)&&audio.duration>0?String(Math.round(audio.currentTime/audio.duration*1000)):'0'; });
audio.addEventListener('ended', () => { if(!repeat) stepTrack(1); });
document.addEventListener('keydown', event => { if(event.key==='/'&&document.activeElement!==filter){event.preventDefault();filter.focus();} if(event.code==='Space'&&document.activeElement!==filter&&currentIndex>=0){event.preventDefault();playButton.click();} });
loadLibrary();
