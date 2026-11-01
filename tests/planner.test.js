// tests/planner.test.js — run with:  node tests/planner.test.js
// Uses only Node's built-in assert. No dependencies.
const assert = require('assert');
const { generatePlan, daysUntil, datedTimeline, budgetTotals, guestStats, buildIdeaPrompt } = require('../planner.js');

const future = (days) => {
  const d = new Date(Date.now() + days * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 1. Budget split sums to the budget for every vertical
for (const [occasion, budget] of [['wedding', 500000], ['birthday', 50000], ['community', 100000]]) {
  const plan = generatePlan({ occasion, date: future(45), guests: 100, budget, city: 'Pune', vibe: '' });
  const sum = plan.budget.reduce((a, b) => a + b.amount, 0);
  assert.strictEqual(sum, budget, `${occasion} budget split must sum to the budget`);
  assert.ok(plan.vendors.length >= 5, `${occasion} should list vendors`);
  assert.ok(plan.ideas.length >= 3, `${occasion} should give ideas`);
  assert.ok(plan.timeline.length >= 4, 'a 45-day runway should give a full timeline');
}

// 2. Timeline compresses when the event is near
const soon = generatePlan({ occasion: 'birthday', date: future(3), guests: 20, budget: 20000 });
assert.ok(soon.timeline.length < 4, 'a 3-day runway should give a compressed timeline');
assert.strictEqual(soon.daysUntil, 3);

// 3. Dated timeline ends exactly on the event date (IST off-by-one regression)
const ev = future(40);
const dated = datedTimeline(generatePlan({ occasion: 'wedding', date: ev, guests: 50, budget: 100000 }), ev);
assert.strictEqual(dated[dated.length - 1].date, ev, 'last timeline item must be the event date itself');

// 4. Planned vs spent
const plan = generatePlan({ occasion: 'birthday', date: future(30), guests: 30, budget: 50000 });
const totals = budgetTotals(plan.budget, { 'Food & Cake': 12000 });
assert.strictEqual(totals.planned, 50000);
assert.strictEqual(totals.actual, 12000);
assert.strictEqual(totals.remaining, 38000);

// 5. Guest stats: expected headcount = yes + maybe
const stats = guestStats([
  { name: 'A', rsvp: 'yes' }, { name: 'B', rsvp: 'maybe' },
  { name: 'C', rsvp: 'no' }, { name: 'D', rsvp: 'yes' },
]);
assert.deepStrictEqual(stats, { total: 4, yes: 2, no: 1, maybe: 1, expected: 3 });

// 6. The Gemini prompt carries the user's context (persona + constraints)
const prompt = buildIdeaPrompt(
  { occasion: 'wedding', city: 'Pune', vibe: 'garden' },
  generatePlan({ occasion: 'wedding', date: future(60), guests: 200, budget: 500000, city: 'Pune', vibe: 'garden' })
);
assert.ok(prompt.includes('Pune') && prompt.includes('200 guests'), 'prompt must include city and guest count');

console.log('All planner tests passed.');

// Regression: plan.budget is the line-items array; the numeric total lives in budgetTotal.
const reg = generatePlan({ occasion: 'wedding', date: future(45), guests: 200, budget: 500000, city: 'Pune', vibe: 'garden' });
assert.strictEqual(reg.budgetTotal, 500000);
assert.ok(Array.isArray(reg.budget));
const regInput = { occasion: 'wedding', date: future(45), guests: 200, budget: 500000, city: 'Pune', vibe: 'garden' };
assert.ok(!buildIdeaPrompt(regInput, reg).includes('[object Object]'), 'prompt must not contain [object Object]');
assert.ok(buildIdeaPrompt(regInput, reg).includes('500000'), 'prompt must carry the numeric budget');
console.log('extra regression checks passed');

// 7. Edge cases (attempt-3 coverage pass)
assert.strictEqual(daysUntil(future(0)), 0, 'today is 0 days away');
assert.strictEqual(daysUntil('2000-01-01'), 0, 'past dates clamp to 0, never negative');
const fallback = generatePlan({ occasion: 'unknown', date: future(10), guests: 10, budget: 10000 });
assert.strictEqual(fallback.occasion, 'birthday', 'unknown occasion falls back to birthday');
const clamped = generatePlan({ occasion: 'birthday', date: future(10), guests: 0, budget: 10 });
assert.strictEqual(clamped.guests, 50, 'a missing/zero guest count falls back to the 50 default');
assert.strictEqual(clamped.budgetTotal, 1000, 'budget clamps to at least 1000');
const emptyStats = guestStats([]);
assert.deepStrictEqual(emptyStats, { total: 0, yes: 0, no: 0, maybe: 0, expected: 0 });
const over = budgetTotals(plan.budget, { 'Food & Cake': 99999 });
assert.ok(over.lines.find((l) => l.item === 'Food & Cake').remaining < 0, 'over-spend shows as negative remaining, not hidden');
const noCity = buildIdeaPrompt({ occasion: 'birthday', vibe: '' }, generatePlan({ occasion: 'birthday', date: future(20), guests: 10, budget: 10000 }));
assert.ok(noCity.includes('India'), 'prompt falls back to India when no city is given');
const mid = datedTimeline(generatePlan({ occasion: 'community', date: future(14), guests: 100, budget: 80000 }), future(14));
assert.strictEqual(mid.length, 4, 'a 14-day runway gives the compressed 4-step dated timeline');
console.log('edge-case tests passed');
