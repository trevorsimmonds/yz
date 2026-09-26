'use strict';

/* =========================================================
   Rules (pure functions — no DOM)
   ========================================================= */
const UPPER = [
  ['ones', 'Ones', 1], ['twos', 'Twos', 2], ['threes', 'Threes', 3],
  ['fours', 'Fours', 4], ['fives', 'Fives', 5], ['sixes', 'Sixes', 6],
];
const LOWER = [
  ['threeKind', '3 of a Kind'], ['fourKind', '4 of a Kind'], ['fullHouse', 'Full House'],
  ['smStraight', 'Sm Straight'], ['lgStraight', 'Lg Straight'], ['yahtzee', 'Yahtzee'],
  ['chance', 'Chance'],
];
const UPPER_KEYS = UPPER.map(u => u[0]);
const LOWER_KEYS = LOWER.map(l => l[0]);
const ALL_KEYS = UPPER_KEYS.concat(LOWER_KEYS);
const LABEL = Object.fromEntries(UPPER.concat(LOWER).map(x => [x[0], x[1]]));

const counts = d => { const c = [0, 0, 0, 0, 0, 0, 0]; d.forEach(v => c[v]++); return c; };
const sum = d => d.reduce((a, b) => a + b, 0);
const isYahtzee = d => d.every(v => v === d[0]);
function hasRun(d, n) {
  const s = new Set(d);
  for (let start = 1; start <= 7 - n; start++) {
    let ok = true;
    for (let i = 0; i < n; i++) if (!s.has(start + i)) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

function baseScore(cat, d) {
  const c = counts(d);
  const max = Math.max(...c);
  const upper = UPPER.find(u => u[0] === cat);
  if (upper) return c[upper[2]] * upper[2];
  switch (cat) {
    case 'threeKind': return max >= 3 ? sum(d) : 0;
    case 'fourKind': return max >= 4 ? sum(d) : 0;
    case 'fullHouse': return c.includes(3) && c.includes(2) ? 25 : 0;
    case 'smStraight': return hasRun(d, 4) ? 30 : 0;
    case 'lgStraight': return hasRun(d, 5) ? 40 : 0;
    case 'yahtzee': return max === 5 ? 50 : 0;
    case 'chance': return sum(d);
  }
  return 0;
}

/* Joker rules apply when a Yahtzee is rolled and the Yahtzee box is already filled (50 or 0). */
const jokerActive = (scores, d) => isYahtzee(d) && scores.yahtzee !== null;

function allowedCategories(scores, d) {
  const open = ALL_KEYS.filter(k => scores[k] === null);
  if (!jokerActive(scores, d)) return open;
  const face = UPPER_KEYS[d[0] - 1];
  if (scores[face] === null) return [face];                 // must use matching upper box
  const lowerOpen = LOWER_KEYS.filter(k => scores[k] === null);
  if (lowerOpen.length) return lowerOpen;                    // any open lower box, full value
  return open;                                               // otherwise scratch an upper box
}

function scoreFor(cat, d, scores) {
  if (jokerActive(scores, d)) {
    if (cat === 'fullHouse') return 25;
    if (cat === 'smStraight') return 30;
    if (cat === 'lgStraight') return 40;
  }
  return baseScore(cat, d);
}

const earnsYahtzeeBonus = (scores, d) => isYahtzee(d) && scores.yahtzee === 50;

function totals(scores, yahtzeeBonuses) {
  const upper = UPPER_KEYS.reduce((a, k) => a + (scores[k] || 0), 0);
  const upperBonus = upper >= 63 ? 35 : 0;
  const lower = LOWER_KEYS.reduce((a, k) => a + (scores[k] || 0), 0);
  const yb = yahtzeeBonuses * 100;
  return { upper, upperBonus, lower, yb, grand: upper + upperBonus + lower + yb };
}

/* =========================================================
   Luck engine — quietly tilts rolls in the player's favour.
   1. Magnet: free dice lean toward faces that help what you're holding
      (more of a held face, or the missing faces of a straight).
   2. Pity meter (pseudo-random distribution): bad turns fill a hidden
      meter; while it's charged, rolls are "best of N" behind the scenes.
      A good turn drains it.
   ========================================================= */
const LUCK = {
  magnet: 0.25,      // extra weight for helpful faces (0 = fair dice)
  pityStep: 0.3,     // meter gain after a bad turn
  pityBase: 0.15,    // chance of a best-of-N roll even with an empty meter
  bestOf: 2,         // candidates considered on a pity roll
};
// Typical score per category, used to judge "good" vs "bad" turns.
const PAR = {
  ones: 2, twos: 5, threes: 8, fours: 11, fives: 14, sixes: 17,
  threeKind: 20, fourKind: 13, fullHouse: 18, smStraight: 22, lgStraight: 18,
  yahtzee: 15, chance: 22,
};
const newLuck = () => ({ pity: 0 });

function faceWeights(dice, held, scores, magnet) {
  const w = [0, 1, 1, 1, 1, 1, 1];
  const hv = dice.filter((_, i) => held[i]);
  if (!hv.length || magnet <= 0) return w;
  const hc = counts(hv);
  const s = [0, 0, 0, 0, 0, 0, 0];
  const kindOpen = scores.threeKind === null || scores.fourKind === null ||
    scores.yahtzee === null || scores.yahtzee === 50 || scores.fullHouse === null;
  // More of the same face
  for (let f = 1; f <= 6; f++) {
    if (!hc[f]) continue;
    if (kindOpen || scores[UPPER_KEYS[f - 1]] === null) s[f] += hc[f] / hv.length;
  }
  // Straights: held faces all distinct and part of an open straight
  const distinct = new Set(hv);
  if (distinct.size === hv.length && hv.length >= 2) {
    const runs = [];
    if (scores.lgStraight === null) runs.push([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]);
    if (scores.smStraight === null) runs.push([1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]);
    const fits = runs.filter(r => hv.every(v => r.includes(v)));
    fits.forEach(r => r.forEach(f => { if (!distinct.has(f)) s[f] += 1 / fits.length; }));
    if (fits.length) for (const f of distinct) s[f] *= 0.2;  // don't pull toward duplicates
  }
  const max = Math.max(...s);
  if (max > 0) for (let f = 1; f <= 6; f++) w[f] = 1 + magnet * (s[f] / max);
  return w;
}

function drawFace(w, rng) {
  let t = rng() * (w[1] + w[2] + w[3] + w[4] + w[5] + w[6]);
  for (let f = 1; f <= 6; f++) { t -= w[f]; if (t < 0) return f; }
  return 6;
}

// How attractive a set of dice is, given open categories.
function rollValue(d, scores) {
  const c = counts(d);
  const max = Math.max(...c);
  let best = 0;
  for (const k of allowedCategories(scores, d)) best = Math.max(best, scoreFor(k, d, scores) - PAR[k]);
  let potential = (max - 1) * 6;
  if (scores.lgStraight === null || scores.smStraight === null) {
    for (let n = 5; n >= 3; n--) if (hasRun(d, n)) { potential = Math.max(potential, (n - 2) * 8); break; }
  }
  if (isYahtzee(d) && (scores.yahtzee === null || scores.yahtzee === 50)) best += 60;
  return best + potential;
}

function luckyRoll(dice, held, scores, luck, rng = Math.random, cfg = LUCK) {
  const w = faceWeights(dice, held, scores, cfg.magnet);
  const once = () => dice.map((v, i) => held[i] ? v : drawFace(w, rng));
  const pity = Math.min(1, cfg.pityBase + luck.pity);
  if (cfg.bestOf < 2 || rng() >= pity) return once();
  let best = once(), bestV = rollValue(best, scores);
  for (let n = 1; n < cfg.bestOf; n++) {
    const cand = once(), v = rollValue(cand, scores);
    if (v > bestV) { best = cand; bestV = v; }
  }
  return best;
}

// Call after a turn is scored.
function updateLuck(luck, cat, score, cfg = LUCK) {
  const good = score >= PAR[cat] + 3 || cat === 'yahtzee' && score === 50;
  const bad = score === 0 || score < PAR[cat] - 2;
  if (good) luck.pity = 0;
  else if (bad) luck.pity = Math.min(1, luck.pity + cfg.pityStep);
  return luck;
}

if (typeof module !== 'undefined') {
  module.exports = { baseScore, scoreFor, allowedCategories, jokerActive, earnsYahtzeeBonus, totals, ALL_KEYS,
    UPPER_KEYS, LOWER_KEYS, PAR, LUCK, newLuck, faceWeights, luckyRoll, updateLuck, counts, hasRun, isYahtzee };
}

/* =========================================================
   Game + UI
   ========================================================= */
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state, undoSnap = null, rolling = false, lastScored = null, confirmTimer = null;

  function freshState() {
    return {
      dice: [1, 1, 1, 1, 1],
      held: [false, false, false, false, false],
      rollsLeft: 3,
      rolled: false,
      round: 1,
      scores: Object.fromEntries(ALL_KEYS.map(k => [k, null])),
      yahtzeeBonuses: 0,
      luck: newLuck(),
    };
  }
  const clone = o => JSON.parse(JSON.stringify(o));

  /* ---------- Build DOM ---------- */
  const rowEls = {};
  function makeRow(key, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row';
    b.dataset.cat = key;
    b.innerHTML = `<span class="name">${label}</span><span class="val"></span>`;
    b.addEventListener('click', () => pick(key));
    rowEls[key] = b;
    return b;
  }
  function makeSub(id, label) {
    const d = document.createElement('div');
    d.className = 'row sub';
    d.id = id;
    d.innerHTML = `<span class="name">${label}</span><span class="val"></span>`;
    return d;
  }
  const upperCol = $('upperCol'), lowerCol = $('lowerCol');
  UPPER.forEach(([k, l]) => upperCol.appendChild(makeRow(k, l)));
  upperCol.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
  upperCol.appendChild(makeSub('upperSum', 'Subtotal'));
  upperCol.appendChild(makeSub('upperBonus', 'Bonus (63+)'));
  LOWER.forEach(([k, l]) => lowerCol.appendChild(makeRow(k, l)));
  lowerCol.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
  lowerCol.appendChild(makeSub('yBonus', 'Yahtzee bonus'));

  const diceEl = $('dice');
  const dieEls = [];
  for (let i = 0; i < 5; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'die';
    b.innerHTML = '<i></i>'.repeat(9);
    b.addEventListener('click', () => toggleHold(i));
    diceEl.appendChild(b);
    dieEls.push(b);
  }

  /* ---------- Actions ---------- */
  function newGame() {
    state = freshState();
    undoSnap = null;
    lastScored = null;
    $('gameOver').hidden = true;
    render();
  }

  function toggleHold(i) {
    if (rolling || !state.rolled || state.rollsLeft === 0 || state.round > 13) return;
    state.held[i] = !state.held[i];
    render();
  }

  function roll() {
    if (rolling || state.rollsLeft === 0 || state.round > 13) return;
    if (state.held.every(Boolean)) return;
    undoSnap = null;
    lastScored = null;
    const final = luckyRoll(state.dice, state.held, state.scores, state.luck);
    state.rollsLeft--;
    state.rolled = true;

    if (reduceMotion) { state.dice = final; render(); return; }

    rolling = true;
    const moving = [0, 1, 2, 3, 4].filter(i => !state.held[i]);
    moving.forEach(i => { dieEls[i].classList.remove('rolling'); void dieEls[i].offsetWidth; dieEls[i].classList.add('rolling'); });
    render();
    const flicker = setInterval(() => {
      moving.forEach(i => drawDie(i, 1 + Math.floor(Math.random() * 6)));
    }, 70);
    setTimeout(() => {
      clearInterval(flicker);
      moving.forEach(i => dieEls[i].classList.remove('rolling'));
      state.dice = final;
      rolling = false;
      render();
    }, 480);
  }

  function pick(cat) {
    if (rolling || !state.rolled || state.round > 13) return;
    if (!allowedCategories(state.scores, state.dice).includes(cat)) return;
    undoSnap = clone(state);
    if (earnsYahtzeeBonus(state.scores, state.dice)) state.yahtzeeBonuses++;
    state.scores[cat] = scoreFor(cat, state.dice, state.scores);
    updateLuck(state.luck, cat, state.scores[cat]);
    lastScored = cat;
    state.round++;
    state.rollsLeft = 3;
    state.rolled = false;
    state.held = [false, false, false, false, false];
    render();
    if (state.round > 13) showGameOver();
  }

  function undo() {
    if (!undoSnap || rolling) return;
    state = undoSnap;
    undoSnap = null;
    lastScored = null;
    $('gameOver').hidden = true;
    render();
  }

  function requestNewGame() {
    const btn = $('newGame');
    const inProgress = state.round <= 13 && (state.round > 1 || state.rolled);
    if (!inProgress || btn.classList.contains('confirm')) {
      clearTimeout(confirmTimer);
      btn.classList.remove('confirm');
      btn.textContent = 'New game';
      newGame();
      return;
    }
    btn.classList.add('confirm');
    btn.textContent = 'Tap to confirm';
    confirmTimer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = 'New game'; }, 3000);
  }

  /* ---------- Render ---------- */
  function drawDie(i, v) {
    const on = v ? PIPS[v] : [];
    dieEls[i].querySelectorAll('i').forEach((p, j) => p.classList.toggle('on', on.includes(j)));
  }

  function render() {
    const { dice, held, rollsLeft, rolled, round, scores, yahtzeeBonuses } = state;
    const over = round > 13;
    const allowed = rolled && !rolling ? allowedCategories(scores, dice) : [];

    // Dice
    dieEls.forEach((el, i) => {
      el.classList.toggle('held', held[i]);
      el.classList.toggle('blank', !rolled);
      el.disabled = !rolled || rollsLeft === 0 || over;
      el.setAttribute('aria-label', rolled ? `Die ${i + 1}: ${dice[i]}${held[i] ? ', held' : ''}` : `Die ${i + 1}`);
      if (!rolling || held[i]) drawDie(i, rolled ? dice[i] : 0);
    });

    // Scorecard rows
    ALL_KEYS.forEach(k => {
      const el = rowEls[k];
      const val = el.querySelector('.val');
      const filled = scores[k] !== null;
      const can = allowed.includes(k);
      el.classList.toggle('filled', filled);
      el.classList.toggle('open', !filled);
      el.classList.toggle('can', can);
      el.disabled = !can;
      if (filled) {
        val.textContent = scores[k];
        el.classList.remove('zero');
      } else if (can) {
        const s = scoreFor(k, dice, scores);
        val.textContent = s;
        el.classList.toggle('zero', s === 0);
      } else {
        val.textContent = '';
        el.classList.remove('zero');
      }
      el.classList.toggle('just', k === lastScored);
      el.setAttribute('aria-label', `${LABEL[k]}: ${filled ? scores[k] + ' points' : can ? 'score ' + val.textContent : 'open'}`);
    });

    const t = totals(scores, yahtzeeBonuses);
    $('upperSum').querySelector('.val').textContent = `${t.upper} / 63`;
    const ub = $('upperBonus');
    ub.querySelector('.val').textContent = t.upperBonus ? '+35' : (UPPER_KEYS.every(k => scores[k] !== null) ? '0' : '—');
    ub.classList.toggle('got', t.upperBonus > 0);
    const yb = $('yBonus');
    yb.querySelector('.val').textContent = yahtzeeBonuses ? `+${t.yb}` : '—';
    yb.classList.toggle('got', yahtzeeBonuses > 0);
    $('grand').textContent = t.grand;

    // Header + buttons
    $('round').textContent = over ? 'Finished' : `Round ${round} / 13`;
    const rollBtn = $('roll');
    rollBtn.disabled = over || rolling || rollsLeft === 0 || held.every(Boolean) && rolled;
    rollBtn.textContent = over ? 'Game over'
      : !rolled ? 'Roll'
      : rollsLeft === 0 ? 'No rolls left'
      : `Roll again (${rollsLeft} left)`;
    $('undo').hidden = !undoSnap || over;

    // Status line
    const status = $('status');
    if (over) status.textContent = 'Game over';
    else if (rolling) status.textContent = 'Rolling…';
    else if (!rolled) status.textContent = lastScored
      ? `Scored ${scores[lastScored]} in ${LABEL[lastScored]}. Roll for round ${round}.`
      : `Roll to start round ${round}.`;
    else if (jokerActive(scores, dice)) {
      const bonus = scores.yahtzee === 50 ? '<b>Yahtzee bonus +100!</b> ' : '<b>Yahtzee!</b> ';
      const forced = allowed.length === 1 ? `Joker: must use ${LABEL[allowed[0]]}.` : 'Joker: pick a highlighted box.';
      status.innerHTML = bonus + forced;
    } else if (isYahtzee(dice) && scores.yahtzee === null) status.innerHTML = '<b>Yahtzee!</b> Pick a category.';
    else if (rollsLeft === 0) status.textContent = 'Pick a category to score.';
    else status.textContent = 'Tap dice to hold, roll again, or pick a category.';
  }

  function showGameOver() {
    const t = totals(state.scores, state.yahtzeeBonuses);
    $('finalScore').textContent = t.grand;
    $('bdUpper').textContent = t.upper;
    $('bdBonus').textContent = t.upperBonus;
    $('bdLower').textContent = t.lower;
    $('bdYB').textContent = t.yb;
    $('goUndo').hidden = !undoSnap;
    $('gameOver').hidden = false;
    $('goNew').focus();
  }

  $('roll').addEventListener('click', roll);
  $('undo').addEventListener('click', undo);
  $('goUndo').addEventListener('click', undo);
  $('goNew').addEventListener('click', newGame);
  $('newGame').addEventListener('click', requestNewGame);

  newGame();

  // Offline / install support (only works when served over http/https)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
