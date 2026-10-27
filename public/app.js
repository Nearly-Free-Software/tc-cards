import { decryptJSON, fromB64, toB64, unlock } from './lock.js';
import * as motion from './motion.js';
import * as pile from './pile.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STATE_KEY = 'tc:v1';
const KEY_KEY = 'tc:key';
const TIP_KEY = 'tc:tip';
const TAP_GUARD_MS = 600;
const THEME_COLORS = { dark: '#17120e', light: '#e7ddcc' };
console.assert(motion.MOTION_MAX < TAP_GUARD_MS, 'card motions must finish inside the tap guard');

// iOS only applies :active (the button press) when the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });

// ---------------------------------------------------------------- storage (never throws)

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or full: carry on in memory */ }
}
function forget(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- app state

let envelope = null;
let decks = {};          // id -> { id, title, subtitle, intro, tip, cards }
let cardsById = {};      // card id -> card
let state = { theme: 'dark', haptics: true, piles: {} };
let deckId = null;       // pile currently open
let guardUntil = 0;
let guardTimer = 0;
let turns = 0;           // Turn presses on the open card; odd = facing the far side
let updateReady = false;

const persist = () => save(STATE_KEY, state);

function setPile(id, p) {
  state.piles[id] = p;
  persist();
}

// ---------------------------------------------------------------- screens & history

const SCREENS = ['loading', 'unlock', 'lid', 'intro', 'card', 'empty', 'about'];
// Where focus lands on each screen, so keyboard and VoiceOver users aren't left on a
// button that just disappeared. Focusing the card makes VoiceOver read the first question.
const FOCUS = { unlock: '#word', lid: '#lid-heading', intro: '#intro-subtitle', card: '#card', empty: '#empty-heading', about: '#about-heading' };
let screen = 'loading';

function show(name, focus = FOCUS[name]) {
  screen = name;
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  if (name === 'card') keepAwake(); else if (name !== 'empty') letSleep();
  window.scrollTo(0, 0);
  if (focus) $(focus)?.focus({ preventScroll: true });
}

// One history entry for anything opened from the lid, so Android's back button returns to the lid.
function openFromLid(name) {
  if (history.state?.tc) history.replaceState({ tc: name }, '');
  else history.pushState({ tc: name }, '');
  show(name);
}

function goLid() {
  if (history.state?.tc) history.back(); // popstate shows the lid
  else showLid();
}

window.addEventListener('popstate', () => {
  if (['intro', 'card', 'empty', 'about'].includes(screen)) showLid();
});

// ---------------------------------------------------------------- theme

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').setAttribute('content', THEME_COLORS[t]);
  for (const r of $$('input[name="theme"]')) r.checked = r.value === t;
}

// ---------------------------------------------------------------- wake lock

let wake = null;
let wantWake = false;

async function keepAwake() {
  wantWake = true;
  if (wake) return;
  if (!('wakeLock' in navigator)) return tipOnce();
  try {
    wake = await navigator.wakeLock.request('screen');
    wake.addEventListener('release', () => { wake = null; });
  } catch {
    tipOnce();
  }
}

function letSleep() {
  wantWake = false;
  wake?.release().catch(() => {});
  wake = null;
}

let lastUpdateCheck = 0;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return motion.settle();
  // An installed app is usually resumed rather than relaunched, so look for a new version
  // (a fix, a changed table word, or a takedown) at most once a minute.
  if ('serviceWorker' in navigator && Date.now() - lastUpdateCheck > 60000) {
    lastUpdateCheck = Date.now();
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  }
  // Re-request after the phone was locked or the app backgrounded. If this fails outside
  // a tap, the next tap on Next tries again.
  if (wantWake && !wake && 'wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then((s) => {
      wake = s;
      s.addEventListener('release', () => { wake = null; });
    }).catch(() => {});
  }
});

window.addEventListener('pagehide', () => motion.settle());

// ---------------------------------------------------------------- haptics (Android only; iOS has no Vibration API)

const canTick = typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;
function tick() {
  if (canTick && state.haptics) try { navigator.vibrate(10); } catch { /* best effort */ }
}

let toastTimer = 0;
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}
$('#toast').addEventListener('click', () => { $('#toast').hidden = true; });

function tipOnce() {
  if (load(TIP_KEY)) return;
  save(TIP_KEY, true);
  toast('If the screen dims while you talk, set your phone’s Auto-Lock to a longer time for the evening.');
}

// ---------------------------------------------------------------- lid

function deckIds(id) {
  return decks[id].cards.map((c) => c.id);
}

// How many pile edges to draw: coarse steps, so the pile visibly thins without anyone counting.
function depthOf(p) {
  const n = pile.left(p);
  return n === 0 ? 0 : Math.ceil((4 * n) / pile.size(p));
}

function showLid() {
  motion.settle();
  if (updateReady) return location.reload();
  for (const id of Object.keys(decks)) {
    const p = state.piles[id];
    const n = pile.left(p);
    $(`[data-open="${id}"]`).dataset.depth = depthOf(p);
    $(`[data-left="${id}"]`).textContent = n === 0 ? 'All drawn' : `${n} of ${pile.size(p)} left`;
    $(`[data-title="${id}"]`).textContent = decks[id].title;
    $(`[data-reshuffle="${id}"]`).setAttribute('aria-label', `Reshuffle ${decks[id].title}`);
  }
  // Coming back from a pile, return focus to that pile's button.
  show('lid', deckId ? `[data-open="${deckId}"]` : undefined);
}

for (const btn of $$('[data-open]')) {
  btn.addEventListener('click', () => openIntro(btn.dataset.open));
}

for (const btn of $$('[data-reshuffle]')) {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.reshuffle;
    if (await confirmReshuffle(id)) {
      const pileBtn = $(`[data-open="${id}"]`);
      const from = Number(pileBtn.dataset.depth);
      setPile(id, pile.newPile(deckIds(id)));
      showLid();
      motion.squareUp(pileBtn, from);
      tick();
    }
  });
}

function confirmReshuffle(id) {
  const dialog = $('#confirm');
  $('#confirm-text').textContent = `Reshuffle ${decks[id].title}? Every card goes back in the pile.`;
  if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm($('#confirm-text').textContent));
  return new Promise((resolve) => {
    dialog.returnValue = '';
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.showModal();
  });
}

$('#open-about').addEventListener('click', () => openFromLid('about'));

// ---------------------------------------------------------------- intro

function openIntro(id) {
  deckId = id;
  const d = decks[id];
  $('#intro-tier').textContent = d.title;
  $('#intro-subtitle').textContent = d.subtitle;
  $('#intro-text').textContent = d.intro;
  $('#intro-tip').textContent = d.tip;
  openFromLid('intro');
}

$('#begin').addEventListener('click', () => {
  setTurns(0); // the card screen is hidden here, so this doesn't spin
  setPile(deckId, pile.begin(state.piles[deckId]));
  showCurrent();
  if (screen === 'card') motion.play('deal');
});

// ---------------------------------------------------------------- card

function renderText(container, text) {
  container.replaceChildren();
  for (const para of text.split(/\n{2,}/)) {
    const p = document.createElement('p');
    para.split('____').forEach((part, i) => {
      if (i > 0) {
        const blank = document.createElement('span');
        blank.className = 'blank';
        const label = document.createElement('span');
        label.className = 'sr-only';
        label.textContent = 'blank';
        blank.append(label);
        p.append(blank);
      }
      if (part) p.append(part);
    });
    container.append(p);
  }
}

function showCurrent() {
  const p = state.piles[deckId];
  // Applies to the empty screen too: its Shuffle button sits right where Next was.
  guardUntil = performance.now() + TAP_GUARD_MS;
  if (pile.isEmpty(p)) {
    $('#empty-tier').textContent = decks[deckId].title;
    if (history.state?.tc) history.replaceState({ tc: 'empty' }, '');
    show('empty');
    return;
  }
  const card = cardsById[pile.current(p)];
  $('#card-label').textContent = `${decks[deckId].title} · ${card.n}`;
  renderText($('#card-text'), card.text);
  $('#card-hint').textContent = card.hint ?? '';
  $('#card-hint').hidden = !card.hint;
  $('#count').textContent = `${pile.drawn(p)} / ${pile.size(p)}`;
  const focused = document.activeElement;
  $('#back').disabled = !pile.canGoBack(p);
  $('#skip').disabled = !pile.canSkip(p);
  if (focused?.disabled) $('#next').focus({ preventScroll: true });

  $('#deck').dataset.tier = deckId;
  $('#deck').dataset.depth = depthOf(p);
  scrollToStart();
  // While the guard is up, guarded buttons show no press (see app.css).
  $('#app').dataset.guard = '';
  clearTimeout(guardTimer);
  guardTimer = setTimeout(() => { delete $('#app').dataset.guard; }, TAP_GUARD_MS);

  if (screen !== 'card') {
    if (history.state?.tc) history.replaceState({ tc: 'card' }, '');
    show('card');
  }
}

// Taps right after a card changes are ignored, so a double tap or a bump while
// passing the phone can't skip a question.
function guarded(fn) {
  return () => {
    if (performance.now() < guardUntil) return;
    fn();
  };
}

// The start of the question: the top, or the bottom when the card is turned round.
function scrollToStart() {
  const area = $('#card-area');
  area.scrollTop = turns % 2 ? area.scrollHeight : 0;
}

function setTurns(n) {
  turns = n;
  $('#card').style.setProperty('--turns', n);
  $('#turn').setAttribute('aria-pressed', String(n % 2 === 1));
}

// Each draw: check it's allowed, capture the outgoing card, change state, render, then
// dress the change with motion and a tick. Motion never gates state.
const goNext = guarded(() => {
  keepAwake(); // first, while the tap still counts as a user gesture
  const ghost = motion.capture();
  setPile(deckId, pile.next(state.piles[deckId]));
  showCurrent();
  motion.play(screen === 'empty' ? 'last' : 'next', ghost);
  tick();
});

const goBack = guarded(() => {
  const p = state.piles[deckId];
  if (!pile.canGoBack(p) && !pile.isEmpty(p)) return;
  const fromEmpty = pile.isEmpty(p);
  const ghost = fromEmpty ? null : motion.capture();
  setPile(deckId, pile.back(p));
  showCurrent();
  motion.play(fromEmpty ? 'return' : 'back', ghost);
  tick();
});

const notThisOne = guarded(() => {
  const p = state.piles[deckId];
  if (!pile.canSkip(p)) return;
  const ghost = motion.capture();
  setPile(deckId, pile.skip(p));
  showCurrent();
  motion.play('skip', ghost);
  tick();
});

$('#next').addEventListener('click', goNext);
$('#back').addEventListener('click', goBack);
$('#empty-back').addEventListener('click', goBack);
$('#skip').addEventListener('click', notThisOne);

$('#turn').addEventListener('click', () => motion.spin(() => {
  setTurns(turns + 1);
  scrollToStart();
}));

$('#shuffle-again').addEventListener('click', guarded(() => {
  setPile(deckId, pile.begin(pile.newPile(deckIds(deckId))));
  showCurrent();
  motion.play('deal');
  tick();
}));

for (const btn of $$('[data-close]')) btn.addEventListener('click', goLid);

document.addEventListener('keydown', (e) => {
  // Leave browser shortcuts (Alt/Cmd+← is Back) and typing in the table-word field alone.
  if (e.altKey || e.metaKey || e.ctrlKey || e.target.id === 'word' || $('#confirm').open) return;
  if (screen === 'card' && e.key === 'ArrowRight') goNext();
  else if ((screen === 'card' || screen === 'empty') && e.key === 'ArrowLeft') goBack();
  else if (['intro', 'card', 'empty', 'about'].includes(screen) && e.key === 'Escape') goLid();
});

// ---------------------------------------------------------------- about

for (const r of $$('input[name="theme"]')) {
  r.addEventListener('change', () => {
    state.theme = r.value;
    persist();
    applyTheme(state.theme);
  });
}

$('#haptics').addEventListener('change', (e) => {
  state.haptics = e.target.checked;
  persist();
  tick();
});

$('#relock').addEventListener('click', () => {
  forget(KEY_KEY);
  history.replaceState(null, '');
  showUnlock();
});

// ---------------------------------------------------------------- unlock & start

function showUnlock(message = '') {
  $('#unlock-msg').textContent = message;
  $('#word').value = '';
  show('unlock');
}

$('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const word = $('#word').value;
  if (!word.trim()) return;
  const btn = $('#unlock-btn');
  btn.disabled = true;
  $('#unlock-msg').textContent = 'Unlocking…';
  try {
    const { raw, data } = await unlock(envelope, word);
    save(KEY_KEY, { salt: envelope.salt, raw: toB64(raw) });
    $('#word').blur();
    start(data);
  } catch {
    $('#unlock-msg').textContent = 'That’s not it.';
    $('#word').select();
  } finally {
    btn.disabled = false;
  }
});

function start(data) {
  decks = {};
  cardsById = {};
  for (const d of data.decks) {
    decks[d.id] = d;
    for (const c of d.cards) cardsById[c.id] = c;
  }
  const stored = load(STATE_KEY) ?? {};
  state = { theme: stored.theme === 'light' ? 'light' : 'dark', haptics: stored.haptics !== false, piles: {} };
  for (const id of Object.keys(decks)) state.piles[id] = pile.repair(stored.piles?.[id], deckIds(id));
  persist();
  applyTheme(state.theme);
  $('#feel').hidden = !canTick;
  $('#haptics').checked = state.haptics;
  navigator.storage?.persist?.().catch(() => {});
  showLid();
}

async function boot() {
  applyTheme(load(STATE_KEY)?.theme);
  registerServiceWorker();
  try {
    const res = await fetch('cards.enc.json');
    if (!res.ok) throw new Error(String(res.status));
    envelope = await res.json();
  } catch {
    $('#loading-msg').textContent = 'Couldn’t open the box. Connect to the internet once, then reopen TC Cards.';
    return;
  }
  const key = load(KEY_KEY);
  if (key?.raw && key.salt === envelope.salt) {
    try {
      return start(await decryptJSON(envelope, fromB64(key.raw)));
    } catch { /* fall through to the unlock screen */ }
  }
  // No key yet, or the table word was changed: ask again. Card progress is kept.
  forget(KEY_KEY);
  showUnlock(key ? 'The table word has changed.' : '');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new version took over. Reload when back at the lid, never mid-card.
    if (!hadController) return;
    updateReady = true;
    if (screen === 'lid' || screen === 'unlock') location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
