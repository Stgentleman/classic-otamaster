(() => {
  'use strict';

  const PX_PER_BEAT = 60;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.1;

  // ---- DOM refs: screens ----
  const screens = {
    home: document.getElementById('screen-home'),
    difficulty: document.getElementById('screen-difficulty'),
    songlist: document.getElementById('screen-songlist'),
    player: document.getElementById('screen-player'),
  };
  const difficultyTitle = document.getElementById('difficultyTitle');
  const difficultyButtonsEl = document.getElementById('difficultyButtons');
  const difficultyModeSwitch = document.getElementById('difficultyModeSwitch');
  const songlistTitle = document.getElementById('songlistTitle');
  const songListEl = document.getElementById('songListEl');
  const playerTitle = document.getElementById('playerTitle');
  const playerSubtitle = document.getElementById('playerSubtitle');
  const playerModeSwitch = document.getElementById('playerModeSwitch');
  const modeBanner = document.getElementById('modeBanner');

  // ---- DOM refs: player ----
  const scoreTrack = document.getElementById('scoreTrack');
  const nowNote = document.getElementById('nowNote');
  const playBtn = document.getElementById('playBtn');
  const iconPlay = playBtn.querySelector('.icon-play');
  const iconPause = playBtn.querySelector('.icon-pause');
  const stopBtn = document.getElementById('stopBtn');
  const loopCheck = document.getElementById('loopCheck');
  const bpmSlider = document.getElementById('bpmSlider');
  const bpmValue = document.getElementById('bpmValue');
  const bpmMinus = document.getElementById('bpmMinus');
  const bpmPlus = document.getElementById('bpmPlus');
  const bpmReset = document.getElementById('bpmReset');
  const metroCheck = document.getElementById('metroCheck');
  const demoCheck = document.getElementById('demoCheck');
  const metroVolSlider = document.getElementById('metroVolSlider');
  const demoVolSlider = document.getElementById('demoVolSlider');
  const beatDotsEl = document.getElementById('beatDots');
  const pendulumArm = document.querySelector('.pendulum-arm');

  const SEMITONES = { 'ド': 0, 'レ': 2, 'ミ': 4, 'ファ': 5, 'ソ': 7, 'ラ': 9, 'シ': 11 };
  const BASE_FREQ = 261.6256; // C4, used as the movable "ド" reference pitch
  const MODE_LABEL = { practice: '演奏練習', performance: '本番演奏' };

  // ---------------- Local storage (favorites / practice status) ----------------

  const STORAGE_KEY = 'classicOtamasterState_v1';

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return { favorites: parsed?.favorites || [], status: parsed?.status || {} };
    } catch {
      return { favorites: [], status: {} };
    }
  }
  function saveStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  }
  const store = loadStore();

  function isFavorite(id) {
    return store.favorites.includes(id);
  }
  function toggleFavorite(id) {
    const i = store.favorites.indexOf(id);
    if (i >= 0) store.favorites.splice(i, 1);
    else store.favorites.push(id);
    saveStore();
  }
  function getSongStatus(id) {
    return store.status[id] || { practiced: false, playCount: 0 };
  }
  function markPracticed(id) {
    const s = getSongStatus(id);
    s.practiced = true;
    s.playCount = (s.playCount || 0) + 1;
    store.status[id] = s;
    saveStore();
  }

  // ---------------- Router ----------------

  const STATE = { screen: 'home', mode: 'practice', expandedDifficulty: null, songId: null };
  const navStack = [];

  function snapshot() {
    return { screen: STATE.screen, mode: STATE.mode, expandedDifficulty: STATE.expandedDifficulty, songId: STATE.songId };
  }

  function showScreenEl(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.hidden = key !== name;
    });
    window.scrollTo(0, 0);
  }

  function renderCurrentScreen() {
    showScreenEl(STATE.screen);
    if (STATE.screen === 'difficulty') renderDifficultyScreen();
    else if (STATE.screen === 'songlist') renderSongListScreen();
    else if (STATE.screen === 'player') renderPlayerScreen();
  }

  function goTo(screenName, patch) {
    navStack.push(snapshot());
    Object.assign(STATE, patch, { screen: screenName });
    renderCurrentScreen();
  }

  function goBack() {
    const prev = navStack.pop();
    if (!prev) {
      STATE.screen = 'home';
    } else {
      Object.assign(STATE, prev);
    }
    if (STATE.screen === 'player' && isPlaying) stopPlayback(true);
    renderCurrentScreen();
  }

  function switchMode() {
    STATE.mode = STATE.mode === 'practice' ? 'performance' : 'practice';
    renderCurrentScreen();
  }

  document.querySelectorAll('[data-back]').forEach((btn) => btn.addEventListener('click', goBack));
  document.querySelectorAll('[data-nav-home]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.navHome;
      if (target === 'practice') goTo('difficulty', { mode: 'practice' });
      else if (target === 'performance') goTo('difficulty', { mode: 'performance' });
      else if (target === 'library') goTo('songlist', {});
    });
  });
  difficultyModeSwitch.addEventListener('click', switchMode);
  playerModeSwitch.addEventListener('click', switchMode);

  // ---------------- Screen renderers ----------------

  function songsForDifficulty(diffId) {
    return window.SONGS.filter((s) => s.difficulty === diffId);
  }

  function difficultyLabel(id) {
    const lvl = window.DIFFICULTY_LEVELS.find((l) => l.id === id);
    return lvl ? lvl.label : id;
  }

  function buildSongCard(s, { showDifficultyTag }) {
    const status = getSongStatus(s.id);
    const card = document.createElement('div');
    card.className = 'song-card';

    const main = document.createElement('div');
    main.className = 'song-card-main';
    main.innerHTML = `
      <div class="song-card-title">${s.title}</div>
      <div class="song-card-sub">${s.subtitle}</div>
      <div class="song-card-badges">
        ${showDifficultyTag ? `<span class="badge tag-${s.difficulty}">${difficultyLabel(s.difficulty)}</span>` : ''}
        ${status.practiced ? '<span class="badge status-practiced">演奏済み</span>' : ''}
      </div>`;
    main.addEventListener('click', () => goTo('player', { songId: s.id }));

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star-btn' + (isFavorite(s.id) ? ' favorited' : '');
    star.textContent = isFavorite(s.id) ? '★' : '☆';
    star.setAttribute('aria-label', 'お気に入り切替');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(s.id);
      renderCurrentScreen();
    });

    card.appendChild(main);
    card.appendChild(star);
    return card;
  }

  function sortByFavorite(list) {
    return list.slice().sort((a, b) => Number(isFavorite(b.id)) - Number(isFavorite(a.id)));
  }

  function renderDifficultyScreen() {
    difficultyTitle.textContent = MODE_LABEL[STATE.mode];
    difficultyModeSwitch.textContent = STATE.mode === 'practice' ? '本番演奏に切替' : '演奏練習に切替';
    difficultyButtonsEl.innerHTML = '';
    window.DIFFICULTY_LEVELS.forEach((level) => {
      const songs = songsForDifficulty(level.id);
      const isOpen = STATE.expandedDifficulty === level.id;

      const item = document.createElement('div');
      item.className = 'accordion-item' + (isOpen ? ' open' : '');

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'difficulty-btn' + (songs.length === 0 ? ' empty' : '');
      header.innerHTML = `
        <span class="difficulty-btn-main"><span>${level.label}</span><span class="count">${songs.length > 0 ? songs.length + '曲' : '準備中'}</span></span>
        <span class="chevron">▾</span>`;
      header.addEventListener('click', () => {
        STATE.expandedDifficulty = isOpen ? null : level.id;
        renderDifficultyScreen();
      });

      const panel = document.createElement('div');
      panel.className = 'accordion-panel';
      if (songs.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'この難易度の曲は準備中です。近日追加予定！';
        panel.appendChild(empty);
      } else {
        sortByFavorite(songs).forEach((s) => panel.appendChild(buildSongCard(s, { showDifficultyTag: false })));
      }

      item.appendChild(header);
      item.appendChild(panel);
      difficultyButtonsEl.appendChild(item);
    });
  }

  function renderSongListScreen() {
    songlistTitle.textContent = '楽曲一覧';
    songListEl.innerHTML = '';
    sortByFavorite(window.SONGS).forEach((s) => songListEl.appendChild(buildSongCard(s, { showDifficultyTag: true })));
  }

  function renderPlayerScreen() {
    const s = window.SONGS.find((x) => x.id === STATE.songId);
    if (!s) return;
    playerTitle.textContent = s.title;
    playerSubtitle.textContent = s.subtitle;
    playerModeSwitch.textContent = STATE.mode === 'practice' ? '本番演奏に切替' : '演奏練習に切替';
    modeBanner.hidden = STATE.mode !== 'performance';
    if (song !== s) loadSong(s);
  }

  // ---------------- Song setup ----------------

  let song = null;
  let bpm = 100;
  let noteTimeline = []; // {note, beatStart, beatEnd}
  let totalBeats = 0;
  let blocks = []; // dom refs aligned with noteTimeline

  let audioCtx = null;
  let masterGain = null;
  let isPlaying = false;
  let isPaused = false;
  let startTime = 0;      // audioCtx time when count-in begins
  let playStartTime = 0;  // audioCtx time when note 0 begins
  let schedulerTimer = null;
  let rafId = null;
  let nextClickBeatIndex = 0; // global beat index (count-in + song) still to schedule
  let totalGlobalBeats = 0;
  let nextNoteScheduleIndex = 0; // index into noteTimeline still to schedule for demo mode
  let reachedEndThisRun = false;

  function loadSong(newSong) {
    stopPlayback(true);
    song = newSong;
    bpm = song.bpm;
    bpmSlider.value = bpm;
    bpmValue.textContent = bpm;

    noteTimeline = [];
    let cursor = 0;
    song.notes.forEach((n) => {
      noteTimeline.push({ note: n, beatStart: cursor, beatEnd: cursor + n.b });
      cursor += n.b;
    });
    totalBeats = cursor;

    renderBeatDots();
    renderScore();
  }

  function renderBeatDots() {
    beatDotsEl.innerHTML = '';
    for (let i = 0; i < song.beatsPerMeasure; i++) {
      const d = document.createElement('span');
      d.className = 'dot';
      beatDotsEl.appendChild(d);
    }
  }

  function renderScore() {
    scoreTrack.innerHTML = '';
    blocks = noteTimeline.map(({ note }) => {
      const el = document.createElement('div');
      const beats = note.b;
      el.style.width = Math.max(30, beats * PX_PER_BEAT - 6) + 'px';
      if (!note.n) {
        el.className = 'note-block rest';
        el.textContent = '休';
      } else {
        el.className = 'note-block';
        el.textContent = note.n;
        if (note.o === 1) {
          const dot = document.createElement('span');
          dot.className = 'oct-dot up';
          el.appendChild(dot);
        } else if (note.o === -1) {
          const dot = document.createElement('span');
          dot.className = 'oct-dot down';
          el.appendChild(dot);
        }
      }
      scoreTrack.appendChild(el);
      return el;
    });
    // Reset scroll to start (first note centered under playhead)
    requestAnimationFrame(() => setTrackPositionAtBeat(0));
    setActiveNote(-1);
    nowNote.textContent = '－';
  }

  function setTrackPositionAtBeat(beats) {
    if (!blocks.length) return;
    const idx = findNoteIndexAtBeat(beats);
    const b = blocks[idx];
    const seg = noteTimeline[idx];
    const frac = seg.beatEnd > seg.beatStart ? (beats - seg.beatStart) / (seg.beatEnd - seg.beatStart) : 0;
    const px = b.offsetLeft + frac * b.offsetWidth;
    scoreTrack.style.transform = `translateX(${-px}px)`;
  }

  function findNoteIndexAtBeat(beats) {
    if (beats <= 0) return 0;
    for (let i = 0; i < noteTimeline.length; i++) {
      if (beats < noteTimeline[i].beatEnd) return i;
    }
    return noteTimeline.length - 1;
  }

  function setActiveNote(idx) {
    blocks.forEach((b, i) => {
      b.classList.toggle('active', i === idx);
      b.classList.toggle('played', idx >= 0 && i < idx);
    });
    if (idx >= 0) {
      const n = noteTimeline[idx].note;
      nowNote.textContent = n.n || '休';
    } else {
      nowNote.textContent = '－';
    }
  }

  // ---------------- Audio ----------------

  let metroNoiseBuffer = null;

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.85;
      masterGain.connect(audioCtx.destination);

      const bufferSize = Math.floor(audioCtx.sampleRate * 0.05);
      metroNoiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = metroNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  // Wooden pendulum-metronome "tock": a bandpass-filtered noise transient
  // (the woody click) layered with a short pitch-dropping thunk (the body).
  function scheduleClick(time, accent) {
    if (!metroCheck.checked) return;
    const vol = metroVolSlider.value / 100;
    if (vol <= 0) return;

    const noise = audioCtx.createBufferSource();
    noise.buffer = metroNoiseBuffer;
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = accent ? 1500 : 1100;
    bandpass.Q.value = 3.5;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, time);
    noiseGain.gain.exponentialRampToValueAtTime((accent ? 0.9 : 0.6) * vol, time + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    noise.connect(bandpass).connect(noiseGain).connect(masterGain);
    noise.start(time);
    noise.stop(time + 0.05);

    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 320 : 260, time);
    osc.frequency.exponentialRampToValueAtTime(accent ? 170 : 140, time + 0.035);
    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.exponentialRampToValueAtTime((accent ? 0.5 : 0.35) * vol, time + 0.003);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(oscGain).connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function noteFrequency(note) {
    if (!note.n) return null;
    const semitone = SEMITONES[note.n];
    const octave = note.o || 0;
    return BASE_FREQ * Math.pow(2, semitone / 12) * Math.pow(2, octave);
  }

  function scheduleNoteTone(time, durationSec, freq) {
    if (!demoCheck.checked || !freq) return;
    const vol = demoVolSlider.value / 100;
    if (vol <= 0) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'triangle';
    const attack = 0.02;
    const release = Math.min(0.09, durationSec * 0.3);
    const sustainEnd = Math.max(time + attack, time + durationSec - release);
    const peak = 0.32 * vol;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(peak, time + attack);
    gain.gain.setValueAtTime(peak, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + durationSec);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + durationSec + 0.02);
  }

  function secPerBeat() {
    return 60 / bpm;
  }

  function schedulerLoop() {
    const spb = secPerBeat();
    while (nextClickBeatIndex < totalGlobalBeats &&
           startTime + nextClickBeatIndex * spb < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      const t = startTime + nextClickBeatIndex * spb;
      const accent = (nextClickBeatIndex % song.beatsPerMeasure) === 0;
      scheduleClick(t, accent);
      nextClickBeatIndex++;
    }
    while (nextNoteScheduleIndex < noteTimeline.length &&
           playStartTime + noteTimeline[nextNoteScheduleIndex].beatStart * spb < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
      const seg = noteTimeline[nextNoteScheduleIndex];
      const t = playStartTime + seg.beatStart * spb;
      const dur = (seg.beatEnd - seg.beatStart) * spb;
      scheduleNoteTone(t, dur, noteFrequency(seg.note));
      nextNoteScheduleIndex++;
    }
  }

  // ---------------- Transport ----------------

  function startPlayback() {
    ensureAudio();
    const spb = secPerBeat();
    startTime = audioCtx.currentTime + 0.12;
    playStartTime = startTime + song.beatsPerMeasure * spb;
    totalGlobalBeats = song.beatsPerMeasure + Math.ceil(totalBeats);
    nextClickBeatIndex = 0;
    nextNoteScheduleIndex = 0;
    reachedEndThisRun = false;

    isPlaying = true;
    isPaused = false;
    playBtn.classList.add('is-playing');
    iconPlay.hidden = true;
    iconPause.hidden = false;

    schedulerTimer = setInterval(schedulerLoop, LOOKAHEAD_MS);
    schedulerLoop();
    rafId = requestAnimationFrame(visualTick);
  }

  function pausePlayback() {
    if (!isPlaying) return;
    isPaused = true;
    isPlaying = false;
    audioCtx.suspend();
    clearInterval(schedulerTimer);
    cancelAnimationFrame(rafId);
    iconPlay.hidden = false;
    iconPause.hidden = true;
    playBtn.classList.remove('is-playing');
  }

  function resumePlayback() {
    if (!isPaused) return;
    isPaused = false;
    isPlaying = true;
    ensureAudio();
    schedulerTimer = setInterval(schedulerLoop, LOOKAHEAD_MS);
    schedulerLoop();
    rafId = requestAnimationFrame(visualTick);
    iconPlay.hidden = true;
    iconPause.hidden = false;
    playBtn.classList.add('is-playing');
  }

  function stopPlayback(silent) {
    isPlaying = false;
    isPaused = false;
    if (schedulerTimer) clearInterval(schedulerTimer);
    if (rafId) cancelAnimationFrame(rafId);
    schedulerTimer = null;
    rafId = null;
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().then(() => {});
    }
    iconPlay.hidden = false;
    iconPause.hidden = true;
    playBtn.classList.remove('is-playing');
    clearBeatDots();
    if (!silent && blocks.length) {
      setActiveNote(-1);
      requestAnimationFrame(() => setTrackPositionAtBeat(0));
    }
  }

  function clearBeatDots() {
    Array.from(beatDotsEl.children).forEach((d) => d.classList.remove('on', 'downbeat'));
    pendulumArm.classList.remove('left', 'right');
  }

  function visualTick() {
    if (!isPlaying) return;
    const now = audioCtx.currentTime;
    const spb = secPerBeat();

    // beat dots + pendulum swing (covers count-in and playback)
    const globalElapsed = now - startTime;
    if (globalElapsed >= 0) {
      const beatIdx = Math.floor(globalElapsed / spb);
      const dotIdx = beatIdx % song.beatsPerMeasure;
      Array.from(beatDotsEl.children).forEach((d, i) => {
        d.classList.toggle('on', i === dotIdx);
        d.classList.toggle('downbeat', i === dotIdx && dotIdx === 0);
      });
      pendulumArm.style.transitionDuration = spb + 's';
      pendulumArm.classList.toggle('left', beatIdx % 2 === 0);
      pendulumArm.classList.toggle('right', beatIdx % 2 === 1);
    }

    const elapsedBeats = (now - playStartTime) / spb;
    if (elapsedBeats < 0) {
      // still counting in
      setTrackPositionAtBeat(0);
    } else if (elapsedBeats >= totalBeats) {
      if (!reachedEndThisRun) {
        reachedEndThisRun = true;
        markPracticed(song.id);
      }
      if (loopCheck.checked) {
        stopPlayback(true);
        startPlayback();
        return;
      } else {
        stopPlayback(false);
        return;
      }
    } else {
      const idx = findNoteIndexAtBeat(elapsedBeats);
      setActiveNote(idx);
      setTrackPositionAtBeat(elapsedBeats);
    }

    rafId = requestAnimationFrame(visualTick);
  }

  // ---------------- UI wiring ----------------

  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      pausePlayback();
    } else if (isPaused) {
      resumePlayback();
    } else {
      startPlayback();
    }
  });

  stopBtn.addEventListener('click', () => stopPlayback(false));

  function setBpm(v) {
    bpm = Math.min(200, Math.max(40, v));
    bpmSlider.value = bpm;
    bpmValue.textContent = bpm;
  }

  bpmSlider.addEventListener('input', (e) => {
    setBpm(parseInt(e.target.value, 10));
    if (isPlaying || isPaused) stopPlayback(false);
  });
  bpmMinus.addEventListener('click', () => {
    setBpm(bpm - 4);
    if (isPlaying || isPaused) stopPlayback(false);
  });
  bpmPlus.addEventListener('click', () => {
    setBpm(bpm + 4);
    if (isPlaying || isPaused) stopPlayback(false);
  });
  bpmReset.addEventListener('click', () => {
    setBpm(song.bpm);
    if (isPlaying || isPaused) stopPlayback(false);
  });

  window.addEventListener('resize', () => {
    if (!isPlaying && screens.player && !screens.player.hidden) {
      requestAnimationFrame(() => setTrackPositionAtBeat(0));
    }
  });

  // ---------------- Service worker ----------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------------- Init ----------------
  renderCurrentScreen();
})();
