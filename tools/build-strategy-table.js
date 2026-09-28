#!/usr/bin/env node
'use strict';

// Builds the "near-optimal" dice-strategy table used to pick which dice to
// hold. This is a one-time offline build step (run with `node
// tools/build-strategy-table.js`) — the output is what ships to players,
// not this script.
//
// ── The algorithm ───────────────────────────────────────────────────────
// This is the standard technique real Yahtzee solvers use for a lightweight
// app (the same simplification the "CodeBreakers" and similar solvers make):
// full optimal play (James Glenn's 2006 result, ~254.6 average score) needs
// a state that tracks the exact upper-section running total, which balloons
// the table to ~13.8GB and ~22 hours to build — not shippable. Dropping the
// running total from the state (i.e. valuing "which categories are still
// open" but not "how close to the 63-point bonus you are") shrinks the
// state space by ~64x, to one entry per one of the 8,192 possible open-
// category combinations (2^13). That's what V[] below is: for each such
// combination, the true expected value of optimal play for the *rest of
// the game*, computed by exact backward induction — no shortcuts inside a
// turn, every one of a turn's three rolls and 32 hold patterns is searched
// exactly, for every one of the 252 possible 5-dice hands.
//
// The cost of dropping bonus-tracking from this table is made up for at
// runtime instead: app.js adds the *current, real* upper-section total and
// Yahtzee-bonus eligibility back in for the live decision (see bestCategory
// / handValue in app.js), since that information is free to use live and
// only this table's *future-turns* estimate needs the simplification.
//
// ── What gets written ───────────────────────────────────────────────────
// strategy-table.bin — a flat Int16Array (values × 10, for one decimal
// place of precision), laid out as:
//   [0 .. 8191]                V[mask]     — value of a fresh turn with
//                                             this category-state, before
//                                             any of its 3 rolls
//   [8192 .. 8192+8192*252-1]  G[mask][h]  — value of hand h (by canonical
//                                             index) with exactly one more
//                                             hold+reroll+score left in the
//                                             turn — i.e. the value used to
//                                             decide what to hold for a
//                                             turn's *second* roll, where
//                                             recomputing this live would
//                                             need a second, too-slow ply
//                                             of lookahead (see app.js).
//
// A turn's *last* reroll and the final scoring choice are still computed
// live in app.js from V[] alone (cheap — one pass over open categories) —
// they don't need G, so G only needs to cover the roll-2 decision.

const path = require('path');
const fs = require('fs');
const { ALL_KEYS, scoreFor, allowedCategories, ALL_HANDS, handIndex } = require('../app.js');

const N = ALL_KEYS.length;              // 13 categories
const NUM_MASKS = 1 << N;               // 8192
const NUM_HANDS = ALL_HANDS.length;     // 252
const CATEGORY_BIT = new Map(ALL_KEYS.map((k, i) => [k, i]));

function popcount(x) { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; }

// Probability of each canonical hand on a fresh roll of 5 fair dice
// (multinomial: 5! / product(multiplicities!) / 6^5).
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
const HAND_PROB = ALL_HANDS.map(h => {
  const counts = {};
  h.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
  let denom = 1;
  Object.values(counts).forEach(c => { denom *= factorial(c); });
  return factorial(5) / denom / Math.pow(6, 5);
});

// Reroll transition tables: for a given multiset of *held* face values,
// the distribution over resulting 5-dice hands (by canonical index) once
// the rest are rerolled. This depends only on which faces are held, never
// on game state, so it's computed once and reused for all 8,192 masks.
const transitionCache = new Map();
function transitionsFor(heldFaces) {
  const key = heldFaces.join(',');
  const hit = transitionCache.get(key);
  if (hit) return hit;
  const m = 5 - heldFaces.length;
  const dist = new Map(); // handIdx -> probability
  if (m === 0) {
    dist.set(handIndex(heldFaces), 1);
  } else {
    const total = Math.pow(6, m);
    const combo = new Array(m).fill(1);
    (function rec(pos) {
      if (pos === m) {
        const idx = handIndex(heldFaces.concat(combo));
        dist.set(idx, (dist.get(idx) || 0) + 1 / total);
        return;
      }
      for (let f = 1; f <= 6; f++) { combo[pos] = f; rec(pos + 1); }
    })(0);
  }
  const arr = Array.from(dist.entries());
  transitionCache.set(key, arr);
  return arr;
}

function heldFacesFor(hand, holdMask) {
  const held = [];
  for (let i = 0; i < 5; i++) if (holdMask & (1 << i)) held.push(hand[i]);
  return held.sort((a, b) => a - b);
}

// scoresStub for a mask: null = category still open, 0 = filled (this
// table doesn't track *what* it was filled with, only that it's gone —
// see the file header on why, and app.js on how that's compensated for).
function scoresStubFor(mask) {
  const s = {};
  ALL_KEYS.forEach((k, i) => { s[k] = (mask & (1 << i)) ? null : 0; });
  return s;
}

const V = new Float64Array(NUM_MASKS);
const G = new Float64Array(NUM_MASKS * NUM_HANDS);

const masksByPopcount = Array.from({ length: NUM_MASKS }, (_, m) => m)
  .sort((a, b) => popcount(a) - popcount(b));

console.time('build');
let done = 0;
for (const mask of masksByPopcount) {
  if (popcount(mask) === 0) { V[mask] = 0; done++; continue; }

  const scoresStub = scoresStubFor(mask);

  // f_final[h] — best score if hand h must be scored right now, plus the
  // value of whatever the game looks like afterward (V of the smaller
  // mask). Exact, no bonus/joker shortcuts skipped.
  const fFinal = new Float64Array(NUM_HANDS);
  for (let hi = 0; hi < NUM_HANDS; hi++) {
    const hand = ALL_HANDS[hi];
    let best = -Infinity;
    for (const cat of allowedCategories(scoresStub, hand)) {
      const s = scoreFor(cat, hand, scoresStub);
      const val = s + V[mask & ~(1 << CATEGORY_BIT.get(cat))];
      if (val > best) best = val;
    }
    fFinal[hi] = best;
  }

  // gLast[h] — best value from hand h with exactly one more hold+reroll,
  // then score. This is what's shipped as G[] for the runtime's roll-2
  // hold decision.
  const gLast = new Float64Array(NUM_HANDS);
  for (let hi = 0; hi < NUM_HANDS; hi++) {
    const hand = ALL_HANDS[hi];
    let best = -Infinity;
    for (let holdMask = 0; holdMask < 32; holdMask++) {
      const trans = transitionsFor(heldFacesFor(hand, holdMask));
      let ev = 0;
      for (const [outIdx, p] of trans) ev += p * fFinal[outIdx];
      if (ev > best) best = ev;
    }
    gLast[hi] = best;
    G[mask * NUM_HANDS + hi] = best;
  }

  // V[mask] — average, over every possible fresh first-roll hand, of the
  // best value achievable with two more hold+reroll decisions ahead.
  let vSum = 0;
  for (let hi = 0; hi < NUM_HANDS; hi++) {
    const hand = ALL_HANDS[hi];
    let best = -Infinity;
    for (let holdMask = 0; holdMask < 32; holdMask++) {
      const trans = transitionsFor(heldFacesFor(hand, holdMask));
      let ev = 0;
      for (const [outIdx, p] of trans) ev += p * gLast[outIdx];
      if (ev > best) best = ev;
    }
    vSum += HAND_PROB[hi] * best;
  }
  V[mask] = vSum;

  done++;
  if (done % 512 === 0) console.log(`${done}/${NUM_MASKS} masks (popcount ${popcount(mask)})`);
}
console.timeEnd('build');

console.log('V[all 13 open] =', V[NUM_MASKS - 1].toFixed(3), '(expect roughly 200-240 — this ignores the upper bonus entirely, so it undershoots the true ~254.6 optimal; see file header)');
console.log('V[nothing open] =', V[0]);

// ---- write out as a single Int16Array, values scaled by 10 -------------
const SCALE = 10;
const out = new Int16Array(NUM_MASKS + NUM_MASKS * NUM_HANDS);
for (let i = 0; i < NUM_MASKS; i++) out[i] = Math.round(V[i] * SCALE);
for (let i = 0; i < NUM_MASKS * NUM_HANDS; i++) out[NUM_MASKS + i] = Math.round(G[i] * SCALE);

const outPath = path.join(__dirname, '..', 'strategy-table.bin');
fs.writeFileSync(outPath, Buffer.from(out.buffer));
console.log('wrote', outPath, '(', (out.byteLength / 1024 / 1024).toFixed(2), 'MB )');
