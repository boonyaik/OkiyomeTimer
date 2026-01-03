// Okiyome Timer PWA - Complete Rewrite

// --- DATA ---
const MASTER_STAGES = [
    { name: "Point 8", duration: 10 * 60, isNew: false },
    { name: "Point 7L", duration: 3 * 60, isNew: false },
    { name: "Point 7R", duration: 3 * 60, isNew: false },
    { name: "Point 7+L", duration: 3 * 60, isNew: true },
    { name: "Point 7+R", duration: 3 * 60, isNew: true },
    { name: "Point 6L", duration: 3 * 60, isNew: false },
    { name: "Point 6R", duration: 3 * 60, isNew: false },
    { name: "Point 1L", duration: 5 * 60, isNew: false },
    { name: "Point 1R", duration: 5 * 60, isNew: false },
    { name: "Extra 1", duration: 3 * 60, isNew: false },
    { name: "Extra 2", duration: 3 * 60, isNew: false },
    { name: "Extra 3", duration: 3 * 60, isNew: false },
    { name: "Extra 4", duration: 3 * 60, isNew: false }
];

const BREAK_DUR = 3;

// --- STATE ---
let state = {
    idx: 0,           // Current Stage Index
    time: 0,          // Current Stage Time (Counts UP)
    lapse: 0,         // Total Session Time (Counts UP)
    active: false,    // Is running?
    break: false,     // Is in break?
    muted: false,
    pid: null,        // Interval ID
    last: 0,          // Last tick timestamp
    residual: 0,      // Fractional accumulator
    showNew: false    // New points enabled? (DEFAULT: FALSE)
};

let activeStages = [];
let wakeLock = null;

// --- DOM CACHE ---
const $ = (id) => document.getElementById(id);
const el = {
    mainTime: $('main-timer'),
    totalTime: $('total-timer'),
    curName: $('current-stage-name'),
    nextName: $('next-stage-name'),

    // Landscape
    landTime: $('landscape-timer'),
    landName: $('landscape-stage-name'),
    landTotal: $('landscape-total-time'),
    landFill: $('landscape-progress-fill'),

    // Controls
    btnStart: $('start-pause-btn'),
    btnReset: $('reset-btn'),
    switchNew: $('toggle-points-switch'), // Checkbox
    btnMute: $('mute-btn'),
    iconMute: $('mute-icon'),
    btnFull: $('fullscreen-btn'),
    btnRest: $('restore-btn'),

    // Picker
    picker: $('stage-picker'),
    ring: document.querySelector('.progress-ring__circle')
};

// --- AUDIO ---
const bell = new Audio('bell-98033.mp3');

// --- SETUP ---
function init() {
    // 1. Ring
    const r = el.ring.r.baseVal.value;
    const c = r * 2 * Math.PI;
    el.ring.style.strokeDasharray = `${c} ${c}`;
    el.ring.style.strokeDashoffset = c; // Empty

    // Create Audio context for iOS if needed or just load
    bell.load();

    // 2. Data Init
    // Sync switch with default state
    if (el.switchNew) el.switchNew.checked = state.showNew;
    updateStageList();

    // 3. Listeners
    el.btnStart.onclick = toggle;
    el.btnReset.onclick = reset;
    if (el.switchNew) el.switchNew.onchange = toggleNewPoints;
    el.btnMute.onclick = mute;
    el.btnFull.onclick = goFull;
    el.btnRest.onclick = exitFull;

    document.addEventListener('visibilitychange', reLock);

    // 4. Initial Render
    render();
}

function updateStageList() {
    activeStages = MASTER_STAGES.filter(s => state.showNew || !s.isNew);
    buildPicker();
}

function toggleNewPoints(e) {
    state.showNew = e.target.checked;

    // Attempt to keep current stage
    const currentName = activeStages[state.idx] ? activeStages[state.idx].name : null;

    updateStageList();

    // Re-map index
    if (currentName) {
        const newIdx = activeStages.findIndex(s => s.name === currentName);
        if (newIdx !== -1) {
            state.idx = newIdx;
        } else {
            // Current stage disappeared (was hidden) -> Reset
            reset();
            return;
        }
    } else {
        // Was finished or invalid
        if (state.idx >= activeStages.length) state.idx = 0;
    }

    scrollToPicker(state.idx);
    render();
    updateUI();
}

// --- CONTROLS ---
function toggle() {
    // Visual Selection Check
    const selIdx = getPickerSelection();

    if (selIdx !== state.idx) {
        jump(selIdx);
    } else {
        if (state.active) pause();
        else start();
    }
}

function start() {
    if (state.active) return;
    state.active = true;
    state.last = performance.now();

    lockScreen();
    unlockAudio(); // iOS requirement
    updateUI();

    // Background Loop
    state.pid = setInterval(tick, 100);
    tick(); // Immediate
}

// iOS Audio Unlock: Play briefly on first user interaction
function unlockAudio() {
    if (window._audioUnlocked) return;
    bell.play().then(() => {
        bell.pause();
        bell.currentTime = 0;
        window._audioUnlocked = true;
    }).catch(e => console.log("Audio unlock failed", e));
}

function pause() {
    state.active = false;
    clearInterval(state.pid);
    state.pid = null;
    unlockScreen();
    updateUI();
}

function reset() {
    pause();
    state.idx = 0;
    state.time = 0;
    state.lapse = 0;
    state.break = false;
    state.residual = 0;

    scrollToPicker(0);

    render();
    updateUI();
}

function jump(i) {
    pause();
    state.idx = i;
    state.time = 0;
    state.break = false;
    state.residual = 0;
    // Keep lapse
    render();
    updateUI();
    start();
}

function mute() {
    state.muted = !state.muted;
    // Icon
    if (state.muted) {
        el.iconMute.innerHTML = `<line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.25 16.25l-1.5-1.5"></path><path d="M10.4 10.4l-1.9-1.9"></path><path d="M6 9h4l5-5v5.5"></path><path d="M6 15h0"></path><rect x="2" y="9" width="4" height="6"></rect>`;
        el.iconMute.setAttribute('stroke', '#a0a0a0');
    } else {
        el.iconMute.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>`;
        el.iconMute.setAttribute('stroke', 'currentColor');
    }
}

// --- ENGINE ---
function tick() {
    if (!state.active) return;

    const now = performance.now();
    const diff = (now - state.last) / 1000;

    if (diff >= 1) {
        const inc = Math.floor(diff);
        state.time += inc;
        state.lapse += inc;
        state.last = now;

        const max = state.break ? BREAK_DUR : activeStages[state.idx].duration;

        if (state.time >= max) {
            nextPhase();
        }

        render();
    }
}

function nextPhase() {
    if (!state.muted) {
        bell.currentTime = 0;
        bell.play().catch(e => console.log(e));
        setTimeout(() => { bell.pause(); bell.currentTime = 0; }, 2000);
    }

    // Stage End -> Next Stage (No Break)
    state.break = false;
    state.idx++;

    if (state.idx >= activeStages.length) {
        finish();
        return;
    }
    state.time = 0;

    scrollToPicker(state.idx);
    render();
    updateUI();
}

function finish() {
    pause();
    state.idx = activeStages.length - 1;
    state.time = activeStages[state.idx].duration;
    render();
    el.btnStart.textContent = "Done";
}

// --- RENDER ---
function fmt(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function render() {
    // Texts
    const tStr = fmt(state.time);
    el.mainTime.textContent = tStr;
    el.landTime.textContent = tStr;
    el.totalTime.textContent = fmt(state.lapse);
    el.landTotal.textContent = `Total: ${fmt(state.lapse)}`;

    // Names
    if (state.idx < activeStages.length) {
        const s = activeStages[state.idx];
        const n = activeStages[state.idx + 1];

        if (state.break) {
            el.curName.textContent = "Relax...";
            el.landName.textContent = "Relax...";
            el.landTime.style.color = "#4cc9f0";
            el.mainTime.style.color = "#4cc9f0";
        } else {
            el.curName.textContent = s.name;
            el.landName.textContent = s.name;
            el.nextName.textContent = n ? `Next: ${n.name}` : "Next: Finish";
            el.landTime.style.color = "";
            el.mainTime.style.color = "";
        }
    } else {
        el.curName.textContent = "Completed";
        el.landName.textContent = "Completed";
    }

    // Progress
    const duration = state.break ? BREAK_DUR : (activeStages[state.idx]?.duration || 10);
    const pct = Math.min(state.time / duration, 1);

    // Ring (Stroke Offset: Full=0, Empty=Circumference)
    // We want filling UP: Start(Empty) -> End(Full)
    const circ = el.ring.style.strokeDasharray.split(' ')[0];
    el.ring.style.strokeDashoffset = circ - (pct * circ);

    // Bar
    el.landFill.style.width = `${pct * 100}%`;

    // Picker Highlight
    updatePickerVisual();
}

function updateUI() {
    // Button Text
    const sel = getPickerSelection();
    if (sel !== state.idx) {
        if (activeStages[sel]) { // Check existence
            el.btnStart.textContent = `Go to ${activeStages[sel].name}`;
        }
        el.btnStart.className = "btn primary";
    } else {
        if (state.active) {
            el.btnStart.textContent = "Pause";
            el.btnStart.className = "btn primary active";
        } else {
            el.btnStart.textContent = "Start";
            el.btnStart.className = "btn primary";
        }
    }
}

// --- PICKER ---
function buildPicker() {
    el.picker.innerHTML = '';
    activeStages.forEach((s, i) => {
        const d = document.createElement('div');
        d.className = 'stage-picker-item';
        d.textContent = `${s.name} (${Math.floor(s.duration / 60)}m)`;
        d.onclick = () => scrollToPicker(i);
        el.picker.appendChild(d);
    });
    el.picker.onscroll = checkPickerScroll;
}

function getPickerSelection() {
    // Based on scroll position
    const center = el.picker.scrollTop + (el.picker.clientHeight / 2);
    let best = 0, min = Infinity;
    Array.from(el.picker.children).forEach((c, i) => {
        const cc = c.offsetTop + (c.clientHeight / 2);
        const diff = Math.abs(center - cc);
        if (diff < min) { min = diff; best = i; }
    });
    return best;
}

function checkPickerScroll() {
    const i = getPickerSelection();
    // highlight logic only, state logic happens in getPickerSelection call inside toggle
    updatePickerVisual(i);
    updateUI(); // Check 'Jump' text
    if (navigator.vibrate && i !== window._lastPick) {
        navigator.vibrate(5);
        window._lastPick = i;
    }
}

function updatePickerVisual(forceIdx) {
    const sel = (forceIdx !== undefined) ? forceIdx : getPickerSelection();
    Array.from(el.picker.children).forEach((c, i) => {
        if (i === sel) c.classList.add('active');
        else c.classList.remove('active');
    });
}

function scrollToPicker(i) {
    const c = el.picker.children[i];
    if (c) {
        el.picker.scrollTo({
            top: c.offsetTop - (el.picker.clientHeight / 2) + (c.clientHeight / 2),
            behavior: 'smooth'
        });
    }
}

// --- FULLSCREEN ---
function goFull() {
    document.body.classList.add('force-landscape');
    if (document.documentElement.requestFullscreen)
        document.documentElement.requestFullscreen().catch(() => { });
}

function exitFull() {
    document.body.classList.remove('force-landscape');
    if (document.exitFullscreen && document.fullscreenElement)
        document.exitFullscreen().catch(() => { });
}

// --- SCREEN LOCK ---
async function lockScreen() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { }
}

async function unlockScreen() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}

function reLock() {
    if (document.visibilityState === 'visible' && state.active) lockScreen();
}

// Start
init();
