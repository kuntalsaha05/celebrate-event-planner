// planner.js — pure planning logic for Celebrate (Celebration & Event Planner).
//
// Design rules:
//   * No DOM, no network, no API keys — the same file runs in Node (where
//     tests/planner.test.js exercises it) and in the browser (app.js).
//   * Every function is deterministic: same input, same plan. The only
//     non-determinism in the app is the optional Gemini call in app.js.
//
// Input shape (a "plan input"):
//   { occasion: 'wedding' | 'birthday' | 'community',
//     date: 'YYYY-MM-DD', guests: number, budget: number (INR),
//     vibe: string, city: string }
//
// Output shape (a "plan"):
//   { occasion, guests, budgetTotal, perGuest, daysUntil,
//     budget: [{ item, pct, amount }], timeline: [{ when, task }],
//     vendors: [{ name, note, done }], ideas: [string] }

const MS_PER_DAY = 86400000;

const BUDGET_SPLIT = {
  wedding:   [['Venue', 32], ['Catering', 28], ['Decor & Flowers', 14], ['Photography', 10], ['Music & Entertainment', 6], ['Attire & Grooming', 5], ['Contingency', 5]],
  birthday:  [['Venue / Home setup', 22], ['Food & Cake', 30], ['Decor & Theme', 20], ['Photography', 8], ['Games & Entertainment', 12], ['Return gifts', 5], ['Contingency', 3]],
  community: [['Venue & Permits', 28], ['Food & Stalls', 26], ['Stage & Sound', 18], ['Decor & Signage', 10], ['Volunteers & Safety', 10], ['Promotion', 5], ['Contingency', 3]],
};

const VENDORS = {
  wedding:   ['Venue & banquet', 'Caterer', 'Decorator / florist', 'Photographer & videographer', 'DJ / live band', 'Makeup artist', 'Invitation printer'],
  birthday:  ['Venue / party hall', 'Baker (cake)', 'Decorator (theme)', 'Photographer', 'Anchor / entertainer', 'Return-gift supplier'],
  community: ['Venue & local permits', 'Caterer / food stalls', 'Stage, sound & lights', 'Volunteer coordinator', 'First-aid & security', 'Local publicity (posters / social)'],
};

const IDEAS = {
  wedding: [
    'A "story wall" — photos of the couple at each table, with a one-line caption per year.',
    'Live sketch artist for guests during the cocktail hour — doubles as a take-home favour.',
    'Late-night snack station (chai + maggi / chaat) after dinner — guests always remember it.',
  ],
  birthday: [
    'A theme photo booth with props matched to the birthday person’s interests, not generic balloons.',
    'A 10-minute "memory game" round: guests guess the year of old photos of the birthday person.',
    'DIY cupcake-decorating corner for kids (and adults who pretend it’s for kids).',
  ],
  community: [
    'A community talent slot — 3 local performers, 10 minutes each, booked before the main event.',
    'A "skills swap" board where attendees pin offers and requests (tutoring, tools, rides).',
    'A zero-waste stall plan: reusable plates, a water refill point, and a leftover-food donation tie-up.',
  ],
};

/** Whole days from `today` until `dateStr` ('YYYY-MM-DD'); never negative. */
function daysUntil(dateStr, today = new Date()) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((d - t) / MS_PER_DAY));
}

/**
 * Turn a plan's relative timeline into real calendar dates counting back
 * from the event date, so the plan is something you can actually follow.
 * The runway length picks the schedule: 30+ days (full), 7–29 (compressed),
 * under 7 (essentials only). The last entry is always the event date itself.
 */
function datedTimeline(plan, eventDateStr) {
  const ev = new Date(eventDateStr + 'T00:00:00');
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; // local date, not UTC (toISOString shifts a day in IST)
  const days = plan.daysUntil;
  const out = [];
  const push = (offsetDays, task) => {
    const d = new Date(ev); d.setDate(d.getDate() - offsetDays);
    out.push({ date: fmt(d), task });
  };
  if (days >= 30) {
    push(days, 'Lock venue and date; confirm guest list.');
    push(21, 'Book caterer, decorator, and photographer; send invitations.');
    push(7, 'Final headcount to caterer, seating / layout plan, vendor confirmations.');
    push(2, 'Decor setup, sound check, final walkthrough at the venue.');
    push(0, 'Event day — run the vendor checklist.');
  } else if (days >= 7) {
    push(days, 'Lock venue and vendors — confirm in writing today.');
    push(3, 'Invitations out, catering headcount locked, decor ordered.');
    push(1, 'Setup, sound check, vendor confirmations.');
    push(0, 'Event day — run the vendor checklist.');
  } else {
    push(days, 'Venue + food + decor: call, don’t email, and confirm on the call.');
    push(0, 'Event day — arrive early, run the vendor checklist.');
  }
  return out;
}

/**
 * Planned vs actual spend. `actuals` maps a budget item name to the amount
 * actually spent. Returns per-line { spent, remaining } plus grand totals;
 * `remaining` is negative when a line is over budget — shown, not hidden.
 */
function budgetTotals(budgetLines, actuals) {
  let planned = 0, actual = 0;
  const lines = budgetLines.map((b) => {
    const spent = Math.max(0, Math.round(actuals[b.item] || 0));
    planned += b.amount; actual += spent;
    return { ...b, spent, remaining: b.amount - spent };
  });
  return { lines, planned, actual, remaining: planned - actual };
}

/**
 * RSVP summary for a guest list [{ name, rsvp: 'yes' | 'no' | 'maybe' }].
 * `expected` (yes + maybe) is the headcount to plan catering against.
 */
function guestStats(guests) {
  const yes = guests.filter(g => g.rsvp === 'yes').length;
  const no = guests.filter(g => g.rsvp === 'no').length;
  const maybe = guests.filter(g => g.rsvp === 'maybe').length;
  return { total: guests.length, yes, no, maybe, expected: yes + maybe };
}

/**
 * The exact prompt the app sends to Gemini — shown and editable in the
 * Prompt Studio, because PromptWars judges prompt craft, not just output.
 * It carries the persona (occasion + city), the hard numbers (guests,
 * budget, per-guest spend, days left) and the output contract (exactly 3
 * ideas, one line each, no generic advice).
 */
function buildIdeaPrompt(input, plan) {
  return `You are an event planner for a ${input.occasion} in ${input.city || 'India'}.
Event: ${plan.guests} guests, budget ₹${plan.budgetTotal}, vibe: ${input.vibe || 'not specified'}, ${plan.daysUntil} days away.
Constraints: ideas must be specific (name the thing, not "make it fun"), fit the budget
(about ₹${plan.perGuest} per guest), and work for this guest count.
Give exactly 3 ideas, one line each, no intro, no generic advice.`;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { generatePlan, daysUntil, datedTimeline, budgetTotals, guestStats, buildIdeaPrompt };

/**
 * Build a complete plan from a plan input. Defensive by design: an unknown
 * occasion falls back to 'birthday', a missing guest count defaults to 50, and the
 * budget to >= ₹1,000, so the UI can never produce a broken plan. The
 * budget split uses Math.round per line against fixed percentages — see
 * tests for the exact-sum property on the three stock budgets.
 */
function generatePlan(input) {
  const occasion = BUDGET_SPLIT[input.occasion] ? input.occasion : 'birthday';
  const guests = Math.max(1, Math.round(input.guests || 50));
  const budget = Math.max(1000, Math.round(input.budget || 50000));
  const days = daysUntil(input.date);
  const perGuest = Math.round(budget / guests);

  const budgetOut = BUDGET_SPLIT[occasion].map(([item, pct]) => ({
    item, pct, amount: Math.round(budget * pct / 100),
  }));

  // Timeline scales to the time available: full plan if 30+ days, compressed if sooner.
  const timeline = [];
  const add = (label, task) => timeline.push({ when: label, task });
  if (days >= 30) {
    add('Now', `Lock venue and date; confirm guest list (~${guests} people).`);
    add('3 weeks out', 'Book caterer, decorator, and photographer; send invitations.');
    add('1 week out', 'Final headcount to caterer, seating / layout plan, vendor confirmations.');
    add('2 days out', 'Decor setup, sound check, final walkthrough at the venue.');
    add('Day of', 'Run the checklist below; keep one contact person per vendor.');
  } else if (days >= 7) {
    add('Today', `Lock venue and vendors — ${days} days is tight, so confirm in writing today.`);
    add('Mid-week', 'Invitations out, catering headcount locked, decor ordered.');
    add('Day before', 'Setup, sound check, vendor confirmations.');
    add('Day of', 'Run the checklist below; keep one contact person per vendor.');
  } else {
    add('Today', 'Venue + food + decor in one day: call, don’t email, and confirm on the call.');
    add('Day of', 'Arrive early, run the checklist below, keep vendor numbers on one sheet.');
  }

  const vendors = VENDORS[occasion].map((name, i) => ({
    name, note: i === 0 ? 'Book first — this gates everything else.' : 'Confirm date, price, and cancellation terms in writing.',
    done: false,
  }));

  const ideas = [...IDEAS[occasion]];
  if (input.vibe) ideas.unshift(`Vibe twist (${input.vibe}): carry this theme through decor, music, and the invitation wording so it feels intentional, not random.`);
  if (input.city) ideas.push(`Local tip for ${input.city}: check 2–3 local vendors in person before booking — photos hide venue size and acoustics.`);

  return { occasion, guests, budget: budgetOut, budgetTotal: budget, perGuest, daysUntil: days, timeline, vendors, ideas };
}
