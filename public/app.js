import { decryptJSON, fromB64, toB64, unlock } from './lock.js';
import * as pile from './pile.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const STATE_KEY = 'tc:v1';
const KEY_KEY = 'tc:key';
const TIP_KEY = 'tc:tip';
const TAP_GUARD_MS = 600;
const THEME_COLORS = { dark: '#17120e', light: '#f5efe4' };

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
let state = { theme: 'dark', piles: {} };
let deckId = null;       // pile currently open
let guardUntil = 0;
let updateReady = false;

const persist = () => save(STATE_KEY, state);

function setPile(id, p) {
  state.piles[id] = p;
  persist();
}

// ---------------------------------------------------------------- screens & history

const SCREENS = ['loading', 'unlock', 'lid', 'intro', 'card', 'empty', 'about'];
let screen = 'loading';

function show(name) {
  screen = name;
  for (const s of SCREENS) $(`#screen-${s}`).hidden = s !== name;
  if (name === 'card') keepAwake(); else if (name !== 'empty') letSleep();
  window.scrollTo(0, 0);
}

// One history entry for anything opened from the lid, so Android's back button returns to the lid.
function openFromLid(name) {
  if (history.state?.linger) history.replaceState({ linger: name }, '');
  else history.pushState({ linger: name }, '');
  show(name);
}

function goLid() {
  if (history.state?.linger) history.back(); // popstate shows the lid
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

document.addEventListener('visibilitychange', () => {
  // Re-request after the phone was locked or the app backgrounded. If this fails outside
  // a tap, the next tap on Next tries again.
  if (document.visibilityState === 'visible' && wantWake && !wake && 'wakeLock' in navigator) {
    navigator.wakeLock.request('screen').then((s) => {
      wake = s;
      s.addEventListener('release', () => { wake = null; });
    }).catch(() => {});
  }
});

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

function showLid() {
  if (updateReady) return location.reload();
  for (const id of Object.keys(decks)) {
    const p = state.piles[id];
    const n = pile.left(p);
    $(`[data-left="${id}"]`).textContent = n === 0 ? 'All drawn' : `${n} of ${pile.size(p)} left`;
    $(`[data-title="${id}"]`).textContent = decks[id].title;
  }
  show('lid');
}

for (const btn of $$('[data-open]')) {
  btn.addEventListener('click', () => openIntro(btn.dataset.open));
}

for (const btn of $$('[data-reshuffle]')) {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.reshuffle;
    if (await confirmReshuffle(id)) {
      setPile(id, pile.newPile(deckIds(id)));
      showLid();
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
  setPile(deckId, pile.begin(state.piles[deckId]));
  $('#card-area').classList.remove('turned');
  $('#turn').setAttribute('aria-pressed', 'false');
  showCurrent();
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
  if (pile.isEmpty(p)) {
    $('#empty-tier').textContent = decks[deckId].title;
    if (history.state?.linger) history.replaceState({ linger: 'empty' }, '');
    show('empty');
    return;
  }
  const card = cardsById[pile.current(p)];
  $('#card-label').textContent = `${decks[deckId].title} · ${card.n}`;
  renderText($('#card-text'), card.text);
  $('#card-hint').textContent = card.hint ?? '';
  $('#card-hint').hidden = !card.hint;
  $('#count').textContent = `${pile.drawn(p)} / ${pile.size(p)}`;
  $('#back').disabled = !pile.canGoBack(p);
  $('#skip').disabled = !pile.canSkip(p);

  const el = $('#card');
  el.classList.remove('enter');
  void el.offsetWidth; // restart the fade
  el.classList.add('enter');
  $('#card-area').scrollTop = 0;
  guardUntil = performance.now() + TAP_GUARD_MS;

  if (screen !== 'card') {
    if (history.state?.linger) history.replaceState({ linger: 'card' }, '');
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

const goNext = guarded(() => {
  keepAwake();
  setPile(deckId, pile.next(state.piles[deckId]));
  showCurrent();
});

const goBack = guarded(() => {
  const p = state.piles[deckId];
  if (!pile.canGoBack(p) && !pile.isEmpty(p)) return;
  setPile(deckId, pile.back(p));
  showCurrent();
});

const notThisOne = guarded(() => {
  const p = state.piles[deckId];
  if (!pile.canSkip(p)) return;
  setPile(deckId, pile.skip(p));
  showCurrent();
});

$('#next').addEventListener('click', goNext);
$('#back').addEventListener('click', goBack);
$('#empty-back').addEventListener('click', goBack);
$('#skip').addEventListener('click', notThisOne);

$('#turn').addEventListener('click', () => {
  const turned = $('#card-area').classList.toggle('turned');
  $('#turn').setAttribute('aria-pressed', String(turned));
});

$('#shuffle-again').addEventListener('click', () => {
  setPile(deckId, pile.begin(pile.newPile(deckIds(deckId))));
  showCurrent();
});

for (const btn of $$('[data-close]')) btn.addEventListener('click', goLid);

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || $('#confirm').open) return;
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
  state = { theme: stored.theme === 'light' ? 'light' : 'dark', piles: {} };
  for (const id of Object.keys(decks)) state.piles[id] = pile.repair(stored.piles?.[id], deckIds(id));
  persist();
  applyTheme(state.theme);
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
    $('#loading-msg').textContent = 'Couldn’t open the box. Connect to the internet once, then reopen Linger.';
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
