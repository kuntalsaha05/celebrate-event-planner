// app.js — Celebrate UI layer.
//
// A planner you keep using, not a one-shot generator. This file owns the DOM,
// persistence and the optional Gemini call; all planning maths lives in
// planner.js (pure functions, unit-tested in tests/planner.test.js).
//
// State model:
//   state.current  — { input, plan } for the plan on screen (null before Generate)
//   state.guests   — [{ name, rsvp }] guest list for the current plan
//   state.actuals  — { budgetItemName: amountSpent } for the budget tracker
// Saved plans are persisted in localStorage under STORAGE_KEY.

(() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'celebrate-plans';
const DAY_MS = 864e5; // milliseconds in one day
const DEFAULT_LEAD_DAYS = 21; // the date field starts three weeks out
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OCCASION_LABELS = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  community: 'Community event',
};
const HTML_ESCAPES = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
};

/* ------------------------------------------------------------------ */
/* Small DOM / formatting helpers                                      */
/* ------------------------------------------------------------------ */

/** Shorthand for getElementById — every element lookup goes through here. */
const $ = (id) => document.getElementById(id);

/** Format a number as Indian Rupees, e.g. 500000 -> "₹5,00,000". */
const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

/**
 * Escape user- or AI-supplied text before it reaches innerHTML.
 * Security boundary: guest names, ideas and Gemini output are untrusted.
 */
const esc = (s) => String(s).replace(/[&<>'"]/g, (c) => HTML_ESCAPES[c]);

/* ------------------------------------------------------------------ */
/* Application state                                                   */
/* ------------------------------------------------------------------ */

const state = {
  current: null, // { input, plan }
  guests: [],
  actuals: {},
};

/** Snapshot everything that defines the plan on screen (for save/share/export). */
function planSnapshot() {
  return { ...state.current, guests: state.guests, actuals: state.actuals };
}

/* ------------------------------------------------------------------ */
/* Persistence — the only two places localStorage is touched for plans */
/* ------------------------------------------------------------------ */

/** Read the saved-plans list; returns [] when nothing is stored. */
function readSavedPlans() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

/** Persist the saved-plans list. */
function writeSavedPlans(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/* ------------------------------------------------------------------ */
/* Rendering — one function per section, renderPlan orchestrates       */
/* ------------------------------------------------------------------ */

/** Render the saved-plans list and wire its load/delete buttons. */
function renderSavedPlans() {
  const list = readSavedPlans();
  $('saved-list').innerHTML = list.length
    ? list.map((p, i) =>
        `<li><button data-load="${i}">${esc(p.input.occasion)} · ${esc(p.input.date)} · ${p.plan.guests} guests · ${fmt(p.plan.budgetTotal)}</button> <button data-del="${i}">✕</button></li>`).join('')
    : '<li class="hint">No saved plans yet — generate one and hit Save.</li>';

  document.querySelectorAll('[data-load]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = readSavedPlans()[+b.dataset.load];
      state.guests = p.guests || [];
      state.actuals = p.actuals || {};
      renderPlan(p.input, p.plan);
    }));

  document.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      const plans = readSavedPlans();
      plans.splice(+b.dataset.del, 1);
      writeSavedPlans(plans);
      renderSavedPlans();
    }));
}

/** Render the budget tracker: planned lines, spend inputs, live totals. */
function renderBudget(input, plan) {
  const totals = budgetTotals(plan.budget, state.actuals);
  $('budget-table').querySelector('tbody').innerHTML = totals.lines.map((l) =>
    `<tr><td>${esc(l.item)}</td><td>${fmt(l.amount)}</td><td><input type="number" min="0" data-spent="${esc(l.item)}" value="${l.spent || ''}" placeholder="0" style="width:110px"></td><td>${fmt(l.remaining)}</td></tr>`).join('');
  $('budget-total').innerHTML =
    `<b>Planned ${fmt(totals.planned)} · Spent ${fmt(totals.actual)} · Left ${fmt(totals.remaining)}</b>`;

  // Editing a spend re-renders so Planned / Spent / Left stay truthful.
  document.querySelectorAll('[data-spent]').forEach((inp) =>
    inp.addEventListener('change', () => {
      state.actuals[inp.dataset.spent] = +inp.value || 0;
      renderPlan(input, plan);
    }));
}

/** Render the dated timeline and the vendor checklist. */
function renderSchedule(input, plan) {
  $('timeline').innerHTML = datedTimeline(plan, input.date)
    .map((t) => `<li><b>${t.date}:</b> ${t.task}</li>`).join('');
  $('vendors').innerHTML = plan.vendors
    .map((v) => `<li><label><input type="checkbox"> <b>${v.name}</b> — ${v.note}</label></li>`).join('');
}

/** Render the ideas list and (re)build the Prompt Studio prompt. */
function renderIdeas(input, plan) {
  $('ideas').innerHTML = plan.ideas.map((i) => `<li>${esc(i)}</li>`).join('');
  $('prompt-text').value = buildIdeaPrompt(input, plan);
  $('ai-note').textContent = 'Built-in ideas above. Edit the prompt and run it with Gemini to upgrade.';
}

/** Render the guest list and its Yes / Maybe / No / Expected summary. */
function renderGuests() {
  const s = guestStats(state.guests);
  $('guest-stats').textContent =
    `Listed: ${s.total} · Yes: ${s.yes} · Maybe: ${s.maybe} · No: ${s.no} · Expected: ${s.expected}`;
  $('guest-list').innerHTML = state.guests
    .map((g, i) => `<li>${esc(g.name)} — ${esc(g.rsvp)} <button data-rm="${i}">✕</button></li>`).join('');
  document.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      state.guests.splice(+b.dataset.rm, 1);
      renderGuests();
    }));
}

/** Render a full plan: header plus every section, then reveal the result. */
function renderPlan(input, plan) {
  state.current = { input, plan };
  $('plan-title').textContent = `${OCCASION_LABELS[plan.occasion]} plan — ${plan.daysUntil} days to go`;
  $('plan-meta').textContent =
    `${plan.guests} guests · Budget ${fmt(plan.budgetTotal)} · ~${fmt(plan.perGuest)} per guest` +
    (input.city ? ` · ${input.city}` : '');

  renderBudget(input, plan);
  renderSchedule(input, plan);
  renderIdeas(input, plan);
  renderGuests();
  $('result').classList.remove('hidden');
}

/* ------------------------------------------------------------------ */
/* Event handlers                                                      */
/* ------------------------------------------------------------------ */

/** Read the form into an input object (the shape planner.js expects). */
function readFormInput() {
  return {
    occasion: $('occasion').value,
    date: $('date').value,
    city: $('city').value.trim(),
    guests: +$('guests').value,
    budget: +$('budget').value,
    vibe: $('vibe').value.trim(),
  };
}

/** Generate: a new plan starts with an empty guest list and no spend. */
function onGenerate() {
  const input = readFormInput();
  if (!input.date) { alert('Pick a date first.'); return; }
  state.guests = [];
  state.actuals = {};
  renderPlan(input, generatePlan(input));
  $('result').scrollIntoView({ behavior: 'smooth' });
}

function onAddGuest() {
  const name = $('guest-name').value.trim();
  if (!name) return;
  state.guests.push({ name, rsvp: $('guest-rsvp').value });
  $('guest-name').value = '';
  renderGuests();
}

function onSavePlan() {
  if (!state.current) return;
  const list = readSavedPlans();
  list.push({ ...planSnapshot(), savedAt: new Date().toISOString() });
  writeSavedPlans(list);
  renderSavedPlans();
  alert('Plan saved.');
}

function onExportPlan() {
  if (!state.current) return;
  const blob = new Blob([JSON.stringify(planSnapshot(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'celebrate-plan.json';
  a.click();
}

async function onSharePlan() {
  if (!state.current) return;
  const url = location.href.split('#')[0] + '#plan=' +
    encodeURIComponent(JSON.stringify(planSnapshot()));
  await navigator.clipboard.writeText(url);
  alert('Share link copied — opening it reloads this plan.');
}

/**
 * Prompt Studio: send the (user-editable) prompt to Gemini and append the
 * returned ideas, marked ✨. The key is the user's own, stays in the
 * browser, and is only ever sent to Google's API.
 */
async function onRunPrompt() {
  const key = $('geminiKey').value.trim();
  const note = $('ai-note');
  if (!key) {
    note.textContent = 'Paste a Gemini API key above to run this prompt. It stays in your browser.';
    return;
  }
  note.textContent = 'Running your prompt with Gemini…';
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: $('prompt-text').value }] }] }),
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    const extra = text.split('\n')
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
    if (extra.length) {
      $('ideas').innerHTML += extra.map((i) => `<li>✨ ${esc(i)}</li>`).join('');
      note.textContent = 'Ideas marked ✨ came from the exact prompt above, via Gemini.';
    } else {
      note.textContent = 'Gemini returned nothing usable — built-in ideas still stand.';
    }
  } catch {
    note.textContent = 'Gemini call failed (check key / connection) — built-in ideas still stand.';
  }
}

/* ------------------------------------------------------------------ */
/* Initialisation                                                      */
/* ------------------------------------------------------------------ */

/** Load a shared plan from the URL hash (#plan=...), if one is present. */
function loadSharedPlan() {
  try {
    const m = location.hash.match(/#plan=(.*)/);
    if (!m) return;
    const shared = JSON.parse(decodeURIComponent(m[1]));
    state.guests = shared.guests || [];
    state.actuals = shared.actuals || {};
    renderPlan(shared.input, shared.plan);
  } catch { /* a malformed share link just leaves the blank form */ }
}

$('date').valueAsDate = new Date(Date.now() + DEFAULT_LEAD_DAYS * DAY_MS);
$('generate').addEventListener('click', onGenerate);
$('add-guest').addEventListener('click', onAddGuest);
$('save-plan').addEventListener('click', onSavePlan);
$('export-plan').addEventListener('click', onExportPlan);
$('share-plan').addEventListener('click', onSharePlan);
$('run-prompt').addEventListener('click', onRunPrompt);

renderSavedPlans();
loadSharedPlan();

})();
