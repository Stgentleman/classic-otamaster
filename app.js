(() => {
  'use strict';

  const PX_PER_BEAT = 60;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD_SEC = 0.1;

  // ---- DOM refs ----
  const songSelect = document.getElementById('songSelect');
  const songSubtitle = document.getElementById('songSubtitle');
  const scoreViewport = document.getElementById('scoreViewport');
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
  const beatDotsEl = document.getElementById('beatDots');

  // ---- State ----
  let songIndex = 0;
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

  // ---------------- Song setup ----------------

  function populateSongSelect() {
    window.SONGS.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = s.title;
      songSelect.appendChild(opt);
    });
  }

  function loadSong(index) {
    stopPlayback(true);
    songIndex = index;
    song = window.SONGS[songIndex];
    bpm = song.bpm;
    bpmSlider.value = bpm;
    bpmValue.textContent = bpm;
    songSubtitle.textContent = song.subtitle;

    // Build cumulative timeline
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

  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.85;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function scheduleClick(time, accent) {
    if (!metroCheck.checked) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.06);
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
  }

  // ---------------- Transport ----------------

  function startPlayback() {
    ensureAudio();
    const spb = secPerBeat();
    startTime = audioCtx.currentTime + 0.12;
    playStartTime = startTime + song.beatsPerMeasure * spb;
    totalGlobalBeats = song.beatsPerMeasure + Math.ceil(totalBeats);
    nextClickBeatIndex = 0;

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
  }

  function visualTick() {
    if (!isPlaying) return;
    const now = audioCtx.currentTime;
    const spb = secPerBeat();

    // beat dots (covers count-in and playback)
    const globalElapsed = now - startTime;
    if (globalElapsed >= 0) {
      const beatIdx = Math.floor(globalElapsed / spb);
      const dotIdx = beatIdx % song.beatsPerMeasure;
      Array.from(beatDotsEl.children).forEach((d, i) => {
        d.classList.toggle('on', i === dotIdx);
        d.classList.toggle('downbeat', i === dotIdx && dotIdx === 0);
      });
    }

    const elapsedBeats = (now - playStartTime) / spb;
    if (elapsedBeats < 0) {
      // still counting in
      setTrackPositionAtBeat(0);
    } else if (elapsedBeats >= totalBeats) {
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

  songSelect.addEventListener('change', (e) => {
    loadSong(parseInt(e.target.value, 10));
  });

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
    if (!isPlaying) requestAnimationFrame(() => setTrackPositionAtBeat(0));
  });

  // ---------------- Service worker ----------------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------------- Init ----------------
  populateSongSelect();
  loadSong(0);
})();
