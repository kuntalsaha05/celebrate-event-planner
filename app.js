// app.js v2 — a planner you keep using, not a one-shot generator.
// State: current plan + guests + actual spend, all persisted in localStorage.
let current = null; // { input, plan }
let guests = [];
let actuals = {};

const $ = (id) => document.getElementById(id);
const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = (s) => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); // escape user text before innerHTML
$('date').valueAsDate = new Date(Date.now() + 21 * 864e5);

function loadSaved() {
  const list = JSON.parse(localStorage.getItem('celebrate-plans') || '[]');
  $('saved-list').innerHTML = list.length ? list.map((p, i) =>
    `<li><button data-load="${i}">${esc(p.input.occasion)} · ${esc(p.input.date)} · ${p.plan.guests} guests · ${fmt(p.plan.budget)}</button> <button data-del="${i}">✕</button></li>`).join('')
    : '<li class="hint">No saved plans yet — generate one and hit Save.</li>';
  document.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
    const p = JSON.parse(localStorage.getItem('celebrate-plans'))[+b.dataset.load];
    guests = p.guests || []; actuals = p.actuals || {}; render(p.input, p.plan);
  }));
  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const list = JSON.parse(localStorage.getItem('celebrate-plans'));
    list.splice(+b.dataset.del, 1); localStorage.setItem('celebrate-plans', JSON.stringify(list)); loadSaved();
  }));
}

function render(input, plan) {
  current = { input, plan };
  const occLabel = { wedding: 'Wedding', birthday: 'Birthday', community: 'Community event' }[plan.occasion];
  $('plan-title').textContent = `${occLabel} plan — ${plan.daysUntil} days to go`;
  $('plan-meta').textContent = `${plan.guests} guests · Budget ${fmt(plan.budget)} · ~${fmt(plan.perGuest)} per guest` + (input.city ? ` · ${input.city}` : '');

  // Budget tracker
  const totals = budgetTotals(plan.budget, actuals);
  $('budget-table').querySelector('tbody').innerHTML = totals.lines.map(l =>
    `<tr><td>${esc(l.item)}</td><td>${fmt(l.amount)}</td><td><input type="number" min="0" data-spent="${esc(l.item)}" value="${l.spent || ''}" placeholder="0" style="width:110px"></td><td>${fmt(l.remaining)}</td></tr>`).join('');
  $('budget-total').innerHTML = `<b>Planned ${fmt(totals.planned)} · Spent ${fmt(totals.actual)} · Left ${fmt(totals.remaining)}</b>`;
  document.querySelectorAll('[data-spent]').forEach(inp => inp.addEventListener('change', () => {
    actuals[inp.dataset.spent] = +inp.value || 0; render(input, plan);
  }));

  // Dated timeline
  $('timeline').innerHTML = datedTimeline(plan, input.date).map(t => `<li><b>${t.date}:</b> ${t.task}</li>`).join('');
  $('vendors').innerHTML = plan.vendors.map(v => `<li><label><input type="checkbox"> <b>${v.name}</b> — ${v.note}</label></li>`).join('');
  $('ideas').innerHTML = plan.ideas.map(i => `<li>${esc(i)}</li>`).join('');
  $('prompt-text').value = buildIdeaPrompt(input, plan);
  $('ai-note').textContent = 'Built-in ideas above. Edit the prompt and run it with Gemini to upgrade.';
  renderGuests();
  $('result').classList.remove('hidden');
}

function renderGuests() {
  const s = guestStats(guests);
  $('guest-stats').textContent = `Listed: ${s.total} · Yes: ${s.yes} · Maybe: ${s.maybe} · No: ${s.no} · Expected: ${s.expected}`;
  $('guest-list').innerHTML = guests.map((g, i) => `<li>${esc(g.name)} — ${esc(g.rsvp)} <button data-rm="${i}">✕</button></li>`).join('');
  document.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { guests.splice(+b.dataset.rm, 1); renderGuests(); }));
}

$('generate').addEventListener('click', () => {
  const input = { occasion: $('occasion').value, date: $('date').value, city: $('city').value.trim(), guests: +$('guests').value, budget: +$('budget').value, vibe: $('vibe').value.trim() };
  if (!input.date) { alert('Pick a date first.'); return; }
  guests = []; actuals = {};
  render(input, generatePlan(input));
  $('result').scrollIntoView({ behavior: 'smooth' });
});

$('add-guest').addEventListener('click', () => {
  const name = $('guest-name').value.trim();
  if (!name) return;
  guests.push({ name, rsvp: $('guest-rsvp').value });
  $('guest-name').value = ''; renderGuests();
});

$('save-plan').addEventListener('click', () => {
  if (!current) return;
  const list = JSON.parse(localStorage.getItem('celebrate-plans') || '[]');
  list.push({ ...current, guests, actuals, savedAt: new Date().toISOString() });
  localStorage.setItem('celebrate-plans', JSON.stringify(list));
  loadSaved(); alert('Plan saved.');
});

$('export-plan').addEventListener('click', () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify({ ...current, guests, actuals }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'celebrate-plan.json'; a.click();
});

$('share-plan').addEventListener('click', async () => {
  if (!current) return;
  const url = location.href.split('#')[0] + '#plan=' + encodeURIComponent(JSON.stringify({ ...current, guests, actuals }));
  await navigator.clipboard.writeText(url); alert('Share link copied — opening it reloads this plan.');
});

// Load a shared plan from the URL hash, if present.
try {
  const m = location.hash.match(/#plan=(.*)/);
  if (m) {
    const shared = JSON.parse(decodeURIComponent(m[1]));
    guests = shared.guests || []; actuals = shared.actuals || {}; render(shared.input, shared.plan);
  }
} catch {}

$('run-prompt').addEventListener('click', async () => {
  const key = $('geminiKey').value.trim();
  const note = $('ai-note');
  if (!key) { note.textContent = 'Paste a Gemini API key above to run this prompt. It stays in your browser.'; return; }
  note.textContent = 'Running your prompt with Gemini…';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: $('prompt-text').value }] }] }),
    });
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    const extra = text.split('\n').map(s => s.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
    if (extra.length) {
      $('ideas').innerHTML += extra.map(i => `<li>✨ ${esc(i)}</li>`).join('');
      note.textContent = 'Ideas marked ✨ came from the exact prompt above, via Gemini.';
    } else note.textContent = 'Gemini returned nothing usable — built-in ideas still stand.';
  } catch { note.textContent = 'Gemini call failed (check key / connection) — built-in ideas still stand.'; }
});

loadSaved();
