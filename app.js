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
   3. Drought protection: if you've gone `droughtStart` turns without a
      Yahtzee, each further turn pulls harder toward matching dice.
   4. Hot streak: right after a Yahtzee, the next `hotStreak` turns get
      the same kind of pull drought protection gives, tapering off by one
      turn at a time — a Yahtzee makes the next one a little more likely,
      the same way a "hot hand" streak mechanic works in other games.
   ========================================================= */
const LUCK = {
  magnet: 0.25,      // extra weight for helpful faces (0 = fair dice)
  pityStep: 0.3,     // meter gain after a bad turn
  pityBase: 0.15,    // chance of a best-of-N roll even with an empty meter
  bestOf: 2,         // candidates considered on a pity roll
  droughtStart: 7,   // turns without a Yahtzee before drought help kicks in (i.e. from round 8)
  droughtMagnet: 0.3,// extra pull toward held matching dice, per drought turn
  droughtPity: 0.2,  // extra best-of-N chance, per drought turn
  hotStreak: 3,      // turns after a Yahtzee that still get the hot-streak pull
  hotMagnet: 0.5,    // extra pull toward held matching dice, per turn of streak left
  hotPity: 0.4,      // extra best-of-N chance, per turn of streak left
};
// Typical score per category, used to judge "good" vs "bad" turns.
const PAR = {
  ones: 2, twos: 5, threes: 8, fours: 11, fives: 14, sixes: 17,
  threeKind: 20, fourKind: 13, fullHouse: 18, smStraight: 22, lgStraight: 18,
  yahtzee: 15, chance: 22,
};
const newLuck = () => ({ pity: 0, dry: 0, hot: 0 });

function faceWeights(dice, held, scores, magnet, kindExtra = 0) {
  const w = [0, 1, 1, 1, 1, 1, 1];
  const hv = dice.filter((_, i) => held[i]);
  if (!hv.length || (magnet <= 0 && kindExtra <= 0)) return w;
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
  // Drought: pull toward the most-held face (not for straight holds)
  const topHeld = Math.max(...hc);
  if (kindExtra > 0 && (topHeld >= 2 || hv.length === 1)) {
    for (let f = 1; f <= 6; f++) if (hc[f] === topHeld) w[f] += kindExtra;
  }
  return w;
}

function drawFace(w, rng) {
  let t = rng() * (w[1] + w[2] + w[3] + w[4] + w[5] + w[6]);
  for (let f = 1; f <= 6; f++) { t -= w[f]; if (t < 0) return f; }
  return 6;
}

// How attractive a set of dice is, given open categories. `boost` is the
// combined drought/hot-streak level — either way, the game currently wants
// to nudge the player toward a big set of matching dice, so both feed the
// same term.
function rollValue(d, scores, boost = 0) {
  const c = counts(d);
  const max = Math.max(...c);
  let best = 0;
  for (const k of allowedCategories(scores, d)) best = Math.max(best, scoreFor(k, d, scores) - PAR[k]);
  let potential = (max - 1) * 6;
  if (scores.lgStraight === null || scores.smStraight === null) {
    for (let n = 5; n >= 3; n--) if (hasRun(d, n)) { potential = Math.max(potential, (n - 2) * 8); break; }
  }
  if (isYahtzee(d) && (scores.yahtzee === null || scores.yahtzee === 50)) best += 60;
  return best + potential + boost * max * 4;
}

const droughtLevel = (luck, scores, cfg) =>
  scores.yahtzee === 0 ? 0 : Math.max(0, (luck.dry || 0) - cfg.droughtStart + 1);
const hotLevel = luck => luck.hot || 0;

function luckyRoll(dice, held, scores, luck, rng = Math.random, cfg = LUCK) {
  const dl = droughtLevel(luck, scores, cfg);
  const hl = hotLevel(luck);
  const kindExtra = dl * (cfg.droughtMagnet || 0) + hl * (cfg.hotMagnet || 0);
  const boost = dl + hl;
  const w = faceWeights(dice, held, scores, cfg.magnet, kindExtra);
  const once = () => dice.map((v, i) => held[i] ? v : drawFace(w, rng));
  const pity = Math.min(1, cfg.pityBase + luck.pity + dl * (cfg.droughtPity || 0) + hl * (cfg.hotPity || 0));
  if (cfg.bestOf < 2 || rng() >= pity) return once();
  let best = once(), bestV = rollValue(best, scores, boost);
  for (let n = 1; n < cfg.bestOf; n++) {
    const cand = once(), v = rollValue(cand, scores, boost);
    if (v > bestV) { best = cand; bestV = v; }
  }
  return best;
}

// Call after a turn is scored. A Yahtzee starts (or refreshes) the hot
// streak; otherwise it counts down by one turn until it's spent.
function updateLuck(luck, cat, score, dice, cfg = LUCK) {
  const gotYahtzee = isYahtzee(dice);
  luck.dry = gotYahtzee ? 0 : (luck.dry || 0) + 1;
  luck.hot = gotYahtzee ? (cfg.hotStreak || 0) : Math.max(0, (luck.hot || 0) - 1);
  const good = score >= PAR[cat] + 3 || cat === 'yahtzee' && score === 50;
  const bad = score === 0 || score < PAR[cat] - 2;
  if (good) luck.pity = 0;
  else if (bad) luck.pity = Math.min(1, luck.pity + cfg.pityStep);
  return luck;
}

/* =========================================================
   Hold suggestion — after a roll, picks which dice look worth
   keeping so the player can just tap to change their mind.
   ========================================================= */
// Fallback only: used for the roll-2 hold decision when the strategy table
// (see below) hasn't loaded yet. The best score this hand can post right
// now, among currently open categories — with Chance left out of the
// comparison as long as another category is still open, since otherwise
// it makes a so-so hand with more rerolls still ahead look falsely "good
// enough to stop here," which is how a two-pair-plus-junk roll used to end
// up recommending you hold the junk too.
function handScoreLegacy(dice, scores, discountChance) {
  const skipChance = discountChance && ALL_KEYS.some(k => k !== 'chance' && scores[k] === null);
  let best = 0;
  for (const k of allowedCategories(scores, dice)) {
    if (k === 'chance' && skipChance) continue;
    const s = scoreFor(k, dice, scores);
    if (s > best) best = s;
  }
  return best;
}

// Which categories are still open, as a 13-bit mask (bit i set means
// ALL_KEYS[i] is open) — the same encoding the strategy table is indexed
// by (see tools/build-strategy-table.js).
const categoryMask = scores => ALL_KEYS.reduce((m, k, i) => scores[k] === null ? m | (1 << i) : m, 0);

// The value of scoring `hand` right now, in whichever open category is
// best. Two parts: the exact, live value of doing it THIS turn — real
// score, the actual Yahtzee bonus (+100) if this hand earns one, and the
// actual +35 upper-section bonus if this category's score would cross the
// real 63-point running total — plus, if the strategy table has loaded,
// its estimate of what the rest of the game is worth with that category
// gone. (The table itself doesn't know about bonuses — see the build
// script's header — but it doesn't need to: only the current, live turn's
// bonus math matters here, since that's the only bonus this decision can
// actually affect.) With no table loaded yet, this still returns the
// bonus-aware immediate score, just without the "is this category worth
// keeping open" half of the picture.
function handValue(hand, scores, strat) {
  const mask = categoryMask(scores);
  const upperTotal = UPPER_KEYS.reduce((a, k) => a + (scores[k] || 0), 0);
  const yahtzeeBonus = earnsYahtzeeBonus(scores, hand) ? 100 : 0;
  let bestCat = null, bestVal = -Infinity;
  for (const k of allowedCategories(scores, hand)) {
    const raw = scoreFor(k, hand, scores);
    let s = raw + yahtzeeBonus;
    if (UPPER_KEYS.includes(k) && upperTotal < 63 && upperTotal + raw >= 63) s += 35;
    const future = strat ? strat.V[mask & ~(1 << ALL_KEYS.indexOf(k))] / STRAT_SCALE : 0;
    const val = s + future;
    if (val > bestVal) { bestVal = val; bestCat = k; }
  }
  return { cat: bestCat, val: bestVal };
}

// Canonical list of every sorted 5-dice hand (252 of them — multisets of
// size 5 from 6 faces) plus a lookup from a hand back to its index. Shared
// between the strategy-table build script and the runtime code that reads
// the table, so the two can never disagree about what index N means.
const ALL_HANDS = (() => {
  const list = [];
  for (let a = 1; a <= 6; a++)
    for (let b = a; b <= 6; b++)
      for (let c = b; c <= 6; c++)
        for (let d = c; d <= 6; d++)
          for (let e = d; e <= 6; e++)
            list.push([a, b, c, d, e]);
  return list;
})();
const handKey = h => h[0] * 7776 + h[1] * 1296 + h[2] * 216 + h[3] * 36 + h[4];
const HAND_INDEX = new Map(ALL_HANDS.map((h, i) => [handKey(h), i]));
const handIndex = hand => HAND_INDEX.get(handKey(hand.slice().sort((a, b) => a - b)));

// Every possible outcome of rerolling n dice, as arrays of face values.
// REROLL_OUTCOMES[3] has all 216 (6^3) three-die combinations, etc.
const REROLL_OUTCOMES = (() => {
  const table = [[[]]];
  for (let n = 1; n <= 5; n++) {
    const prev = table[n - 1], cur = [];
    for (const combo of prev) for (let f = 1; f <= 6; f++) cur.push(combo.concat(f));
    table.push(cur);
  }
  return table;
})();

// The strategy table (see tools/build-strategy-table.js) ships two arrays
// packed into one Int16Array, values scaled by STRAT_SCALE for one decimal
// place of precision in an integer-typed file:
//   V[mask]      — 8,192 entries — value of a fresh turn with this
//                  category-state, before any of its 3 rolls.
//   G[mask][h]   — 8,192 × 252 entries — value of hand h (by canonical
//                  ALL_HANDS index) with exactly one more hold+reroll+
//                  score left in the turn.
// `loadStrategyTable(buf)` (below, in the browser section) turns the raw
// bytes into `{ V, G }` views over that same buffer — nothing here decodes
// the file, so these pure functions stay Node-testable without a fetch.
const STRAT_SCALE = 10;
const NUM_HANDS = ALL_HANDS.length;

// True Yahtzee-optimal play needs a state that also tracks the exact
// upper-section running total — James Glenn's classic solver runs to about
// 13.8GB and takes ~22 hours to build that way, not something a phone app
// can ship. The strategy table instead uses the standard lightweight
// simplification real Yahtzee solvers ship with: value the 8,192 possible
// "which categories are still open" states by exact backward induction,
// but don't track progress toward the 63-point bonus in that table (see
// the build script's header for the full write-up, and handValue above for
// how the live bonus math is added back in for the decision that's
// actually being made right now).
//
// `prevHeld` dice are never reconsidered for rerolling — this both keeps
// a player's own choice intact and lets a turn's second and third rolls
// reuse the (much smaller) search over only the dice still in play.
// `discountChance` should be true whenever another reroll follows this one
// — false only for the roll that will be a turn's last, when the
// resulting hand truly will be scored as-is.
function bestHold(prevHeld, dice, scores, discountChance, strat) {
  const freeIdx = [0, 1, 2, 3, 4].filter(i => !prevHeld[i]);
  const n = freeIdx.length;
  const mask = strat && discountChance ? categoryMask(scores) : 0;

  // Many reroll outcomes land on the exact same 5-dice hand (order aside),
  // and every hold pattern shares the same `scores`, so cache each hand's
  // value for the whole call — cuts the worst case (first roll, every
  // category open) from ~16,800 evaluations down to the ≤252 distinct
  // 5-dice hands that actually exist.
  const cache = new Map();
  const cachedScore = hand => {
    const key = hand[0] * 7776 + hand[1] * 1296 + hand[2] * 216 + hand[3] * 36 + hand[4];
    let v = cache.get(key);
    if (v === undefined) {
      // Deciding hold for a non-final reroll: look up (or fall back to
      // approximating) the value of "one more hold+reroll, then score" —
      // never just this hand's own immediate score, which is a different
      // question (see the module doc comment above bestHold).
      v = discountChance
        ? (strat ? strat.G[mask * NUM_HANDS + handIndex(hand)] / STRAT_SCALE : handScoreLegacy(hand, scores, true))
        : handValue(hand, scores, strat).val;
      cache.set(key, v);
    }
    return v;
  };

  let bestMask = 0, bestEV = -Infinity;
  const hand = dice.slice();
  for (let holdMask = 0; holdMask < (1 << n); holdMask++) {
    const rerollIdx = freeIdx.filter((_, j) => !((holdMask >> j) & 1));
    const outcomes = REROLL_OUTCOMES[rerollIdx.length];
    let total = 0;
    for (const combo of outcomes) {
      for (let i = 0; i < dice.length; i++) hand[i] = dice[i];
      rerollIdx.forEach((idx, j) => { hand[idx] = combo[j]; });
      hand.sort((a, b) => a - b);
      total += cachedScore(hand);
    }
    const ev = total / outcomes.length;
    if (ev > bestEV) { bestEV = ev; bestMask = holdMask; }
  }
  const held = prevHeld.slice();
  freeIdx.forEach((idx, j) => { held[idx] = !!((bestMask >> j) & 1); });
  return held;
}

const suggestHold = (dice, scores, discountChance = true, strat = null) =>
  bestHold([false, false, false, false, false], dice, scores, discountChance, strat);
const nextHeld = (prevHeld, dice, scores, discountChance = true, strat = null) =>
  bestHold(prevHeld, dice, scores, discountChance, strat);

// When a turn's rolls run out, the game scores it for you automatically —
// whichever open category this hand is worth the most in, per handValue
// above (real score + real bonuses this turn, plus the table's estimate of
// what keeping each category open would be worth for the rest of the game).
function bestCategory(dice, scores, strat = null) {
  return handValue(dice, scores, strat).cat;
}

if (typeof module !== 'undefined') {
  module.exports = { baseScore, scoreFor, allowedCategories, jokerActive, earnsYahtzeeBonus, totals, ALL_KEYS,
    UPPER_KEYS, LOWER_KEYS, PAR, LUCK, newLuck, faceWeights, luckyRoll, updateLuck, counts, hasRun, isYahtzee,
    suggestHold, nextHeld, bestCategory, ALL_HANDS, handIndex, handValue, categoryMask, STRAT_SCALE, NUM_HANDS };
}

/* =========================================================
   Game + UI
   ========================================================= */
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // The precomputed dice-strategy table (see tools/build-strategy-table.js) —
  // null until it's loaded, in which case hold suggestions and auto-scoring
  // fall back to a simpler heuristic (still correct, just less far-sighted).
  // It's a small file and the service worker caches it offline, so in
  // practice this resolves near-instantly on every visit after the first.
  let strat = null;
  fetch('strategy-table.bin').then(r => r.ok ? r.arrayBuffer() : Promise.reject(r.status)).then(buf => {
    const NUM_MASKS = 8192;
    const flat = new Int16Array(buf);
    strat = { V: flat.subarray(0, NUM_MASKS), G: flat.subarray(NUM_MASKS) };
  }).catch(() => { /* offline on first visit before the SW has cached it, or a fetch error — keep the fallback */ });

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
  const progress = Object.assign(document.createElement('div'), { className: 'progress' });
  progress.innerHTML = '<i id="upperBar"></i><i id="upperSpark" class="spark"></i>';
  upperCol.appendChild(progress);
  const pacePill = Object.assign(document.createElement('div'), { className: 'pace', id: 'pacePill' });
  pacePill.hidden = true;
  pacePill.textContent = '🎯 On pace for bonus';
  upperCol.appendChild(pacePill);
  upperCol.appendChild(makeSub('upperBonus', 'Bonus (63+)'));
  LOWER.forEach(([k, l]) => lowerCol.appendChild(makeRow(k, l)));
  lowerCol.appendChild(Object.assign(document.createElement('div'), { className: 'sep' }));
  lowerCol.appendChild(makeSub('yBonus', 'Yahtzee bonus'));

  /* ---------- Themes ---------- */
  const THEMES = [
    { id: 'classic', name: 'Classic', felt: '#22684d', accent: '#eab03a' },
    { id: 'midnight', name: 'Midnight', felt: '#2b2170', accent: '#3ee6ff' },
    { id: 'ocean', name: 'Ocean', felt: '#117093', accent: '#ff9f59' },
    { id: 'sunset', name: 'Sunset', felt: '#8a3358', accent: '#ffa24c' },
  ];
  let theme = 'classic';
  try { theme = localStorage.getItem('yz-theme') || 'classic'; } catch (_) {}
  function applyTheme(id) {
    theme = id;
    document.documentElement.dataset.theme = id;
    try { localStorage.setItem('yz-theme', id); } catch (_) {}
    themeGrid.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', String(s.dataset.id === id)));
  }
  const themeGrid = $('themeGrid');
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.id = t.id;
    b.innerHTML = `<span class="mini" style="background:${t.felt}"><b style="background:${t.accent}"></b></span>${t.name}`;
    b.addEventListener('click', () => applyTheme(t.id));
    themeGrid.appendChild(b);
  });
  applyTheme(theme);
  $('themeBtn').addEventListener('click', () => { $('themePicker').hidden = false; });
  $('themeClose').addEventListener('click', () => { $('themePicker').hidden = true; });
  $('themePicker').addEventListener('click', e => { if (e.target.id === 'themePicker') $('themePicker').hidden = true; });

  /* ---------- Confetti-on-roll toggle ---------- */
  let confettiOnRoll = false;
  try { confettiOnRoll = localStorage.getItem('yz-confetti-roll') === '1'; } catch (_) {}
  const confettiBtn = $('confettiToggle');
  confettiBtn.setAttribute('aria-pressed', String(confettiOnRoll));
  confettiBtn.addEventListener('click', () => {
    confettiOnRoll = !confettiOnRoll;
    confettiBtn.setAttribute('aria-pressed', String(confettiOnRoll));
    try { localStorage.setItem('yz-confetti-roll', confettiOnRoll ? '1' : '0'); } catch (_) {}
  });

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
    const prevHeld = state.held.slice();
    const final = luckyRoll(state.dice, state.held, state.scores, state.luck);
    state.rollsLeft--;
    state.rolled = true;

    if (reduceMotion) {
      state.dice = final;
      state.held = state.rollsLeft > 0 ? nextHeld(prevHeld, final, state.scores, state.rollsLeft > 1, strat) : [false, false, false, false, false];
      render();
      if (isYahtzee(final)) celebrate(false);
      else rollConfetti();
      if (state.rollsLeft === 0) autoScore();
      return;
    }

    rolling = true;
    const moving = [0, 1, 2, 3, 4].filter(i => !state.held[i]);
    const DUR = 460, STAGGER = 55;
    moving.forEach((i, n) => {
      const el = dieEls[i];
      el.classList.remove('rolling');
      void el.offsetWidth;
      el.style.setProperty('--dur', DUR + 'ms');
      el.style.setProperty('--delay', (n * STAGGER) + 'ms');
      el.classList.add('rolling');
    });
    render();
    const flicker = setInterval(() => {
      moving.forEach(i => drawDie(i, 1 + Math.floor(Math.random() * 6)));
    }, 70);
    const total = DUR + (moving.length - 1) * STAGGER;
    setTimeout(() => {
      clearInterval(flicker);
      moving.forEach(i => dieEls[i].classList.remove('rolling'));
      state.dice = final;
      state.held = state.rollsLeft > 0 ? nextHeld(prevHeld, final, state.scores, state.rollsLeft > 1, strat) : [false, false, false, false, false];
      rolling = false;
      render();
      if (isYahtzee(final) && (state.scores.yahtzee === null || state.scores.yahtzee === 50)) celebrate(state.scores.yahtzee === 50);
      else rollConfetti();
      if (state.rollsLeft === 0) autoScore();
    }, total);
  }

  // Once a turn's last roll is used, no more decisions to make — score the
  // hand in whatever open category it scores highest in and move on. A short
  // pause lets the player see the final roll (and any Yahtzee celebration)
  // before it locks in; Undo still reverses it if they'd have chosen
  // differently.
  function autoScore() {
    const cat = bestCategory(state.dice, state.scores, strat);
    if (!cat) return;
    setTimeout(() => { if (!rolling && state.rollsLeft === 0) pick(cat); }, reduceMotion ? 500 : 900);
  }

  /* ---------- Celebration ---------- */
  const canvas = $('confetti'), ctx = canvas.getContext ? canvas.getContext('2d') : null;

  // Fires a burst of confetti from a point (defaults to top-center, like the
  // Yahtzee celebration). Several bursts can run concurrently — each keeps
  // its own particle list and cancels only its own animation frame loop.
  function burstConfetti({ count = 100, x = innerWidth / 2, y = innerHeight * 0.3, spread = 80, life = 2600 } = {}) {
    if (reduceMotion || !ctx) return;
    canvas.hidden = false;
    canvas.width = innerWidth; canvas.height = innerHeight;
    const cs = getComputedStyle(document.documentElement).getPropertyValue('--confetti');
    const colors = cs.split(',').map(s => s.trim()).filter(Boolean);
    const pieces = Array.from({ length: count }, () => ({
      x: x + (Math.random() - 0.5) * spread,
      y,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 10 - 4,
      s: Math.random() * 6 + 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    activeBursts.push(pieces);
    const start = performance.now();
    function tick(now) {
      const dt = Math.min(32, now - (tick.last || now)); tick.last = now;
      let alive = false;
      for (const p of pieces) {
        p.vy += 0.028 * dt;
        p.x += p.vx * (dt / 16); p.y += p.vy * (dt / 16); p.rot += p.vr;
        if (p.y < canvas.height + 20) alive = true;
      }
      if (alive && now - start < life) {
        requestAnimationFrame(tick);
      } else {
        const idx = activeBursts.indexOf(pieces);
        if (idx !== -1) activeBursts.splice(idx, 1);
        if (!activeBursts.length) canvas.hidden = true;
      }
      redrawConfetti();
    }
    requestAnimationFrame(tick);
  }

  // All active bursts share one canvas, so every burst's tick redraws the
  // full set — otherwise an older burst finishing first would wipe a newer
  // one's frame (or vice versa) instead of drawing both.
  const activeBursts = [];
  function redrawConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const pieces of activeBursts) {
      for (const p of pieces) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6);
        ctx.restore();
      }
    }
  }

  function celebrate(bonus) {
    if (reduceMotion) return;
    const host = $('bannerHost');
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.innerHTML = bonus
      ? '<span>YAHTZEE!<small>+100 bonus</small></span>'
      : '<span>YAHTZEE!</span>';
    host.appendChild(banner);
    setTimeout(() => banner.remove(), 1650);
    dieEls.forEach(el => { el.classList.remove('yz'); void el.offsetWidth; el.classList.add('yz'); });
    burstConfetti({ count: bonus ? 160 : 100 });
  }

  // A light burst from the dice area for the confetti-on-every-roll toggle —
  // much smaller and shorter-lived than the Yahtzee celebration so it doesn't
  // overwhelm a game with 39 rolls in it.
  function rollConfetti() {
    if (!confettiOnRoll) return;
    const r = diceEl.getBoundingClientRect();
    burstConfetti({ count: 26, x: r.left + r.width / 2, y: r.top + r.height / 2, spread: r.width, life: 1100 });
  }

  function scorePop(cat, value) {
    if (reduceMotion || value <= 0) return;
    const from = diceEl.getBoundingClientRect();
    const to = rowEls[cat].querySelector('.val').getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'pop';
    pop.textContent = '+' + value;
    pop.style.left = (from.left + from.width / 2) + 'px';
    pop.style.top = (from.top + from.height / 2) + 'px';
    document.body.appendChild(pop);
    pop.animate(
      [{ left: pop.style.left, top: pop.style.top }, { left: (to.left + to.width / 2) + 'px', top: (to.top) + 'px' }],
      { duration: 620, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'forwards' }
    );
    setTimeout(() => pop.remove(), 900);
  }

  function pick(cat) {
    if (rolling || !state.rolled || state.round > 13) return;
    if (!allowedCategories(state.scores, state.dice).includes(cat)) return;
    undoSnap = clone(state);
    if (earnsYahtzeeBonus(state.scores, state.dice)) state.yahtzeeBonuses++;
    const value = scoreFor(cat, state.dice, state.scores);
    scorePop(cat, value);
    state.scores[cat] = value;
    updateLuck(state.luck, cat, state.scores[cat], state.dice);
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
    const upperPct = Math.min(100, (t.upper / 63) * 100);
    $('upperBar').style.width = upperPct + '%';
    const upperFilled = UPPER_KEYS.filter(k => scores[k] !== null).length;
    const upperDone = upperFilled === UPPER_KEYS.length;
    const progEl = $('upperBar').parentElement;
    progEl.classList.remove('near1', 'near2', 'near3');
    if (!t.upperBonus && !upperDone) {
      if (upperPct >= 85) progEl.classList.add('near3');
      else if (upperPct >= 65) progEl.classList.add('near2');
      else if (upperPct >= 35) progEl.classList.add('near1');
    }
    const onPace = upperFilled > 0 && t.upper >= (upperFilled / UPPER_KEYS.length) * 63 - 0.01;
    progEl.classList.toggle('on-pace', !t.upperBonus && !upperDone && onPace);
    const pacePill = $('pacePill');
    pacePill.hidden = over || t.upperBonus > 0 || upperDone || upperFilled === 0 || !onPace;
    const ub = $('upperBonus');
    ub.querySelector('.val').textContent = t.upperBonus ? '+35' : (UPPER_KEYS.every(k => scores[k] !== null) ? '0' : '—');
    ub.classList.toggle('got', t.upperBonus > 0);
    const yb = $('yBonus');
    yb.querySelector('.val').textContent = yahtzeeBonuses ? `+${t.yb}` : '—';
    yb.classList.toggle('got', yahtzeeBonuses > 0);
    $('grand').textContent = t.grand;

    // Header + buttons
    $('round').textContent = over ? 'Finished' : `Round ${round} / 13`;
    $('streak').hidden = over || !(state.luck && state.luck.hot > 0);
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
    else if (rollsLeft === 0) status.textContent = 'Out of rolls — scoring the best category…';
    else status.textContent = held.some(Boolean)
      ? 'We held our pick — tap any die to change it, then roll again.'
      : 'Tap dice to hold, roll again, or pick a category.';
  }

  function showGameOver() {
    document.querySelectorAll('.pop').forEach(p => p.remove());
    const t = totals(state.scores, state.yahtzeeBonuses);
    const el = $('finalScore');
    $('bdUpper').textContent = t.upper;
    $('bdBonus').textContent = t.upperBonus;
    $('bdLower').textContent = t.lower;
    $('bdYB').textContent = t.yb;
    $('verdict').textContent =
      t.grand >= 300 ? "Fantastic game!" :
      t.grand >= 230 ? "Solid score!" :
      t.grand >= 150 ? "Nice game." : "Better luck next time.";
    $('goUndo').hidden = !undoSnap;
    $('gameOver').hidden = false;
    $('goNew').focus();
    if (reduceMotion) { el.textContent = t.grand; return; }
    const start = performance.now(), dur = 900;
    (function tick(now) {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(t.grand * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    })(start);
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
