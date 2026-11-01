# Celebrate — GenAI Celebration & Event Planner

**PromptWars Virtual · Challenge 05 — Celebration & Event Planner**
A smart, dynamic planning assistant for weddings, birthdays, and community
events. It does not just generate a plan once — you save plans, track guests,
and spend against the budget, so it stays useful from the first idea to the
event day.

**Live app:** _(GitHub Pages URL — add after enabling Pages: Settings → Pages → Deploy from branch → `main`)_
**Repository rules check:** public · single branch (`main`) · total size ≈ 30 KB (limit 10 MB)

---

## 1. Chosen vertical

**Celebration & Event Planner** — one vertical, three personas inside it:

| Persona | Who they are | What they struggle with |
|---|---|---|
| Wedding planner (often the couple / family) | High budget, 100–500 guests, many vendors | Budget split across vendors, booking order, deadlines |
| Birthday organiser (parent / friend) | Small budget, short runway | Theme ideas, food/cake sizing, doing it fast |
| Community organiser (volunteer) | Many stakeholders, permits, volunteers | Permits, volunteers & safety, promotion |

The assistant adapts to the persona: budget splits, vendor lists, timeline
depth, and ideas are all different per occasion — the same input form produces
a genuinely different plan, not a re-skinned one.

## 2. Approach and logic

The core idea: **deterministic planning logic + an inspectable GenAI layer.**

- **Planning is rule-based and testable** (`planner.js`, pure functions, no
  DOM, no network). Rules encode how event planning actually works:
  - *Budget splits per occasion* — a wedding spends ~32% on venue; a birthday
    spends ~30% on food & cake. Percentages always sum to 100%, and the split
    is scaled to the user's exact budget and a per-guest figure is derived.
  - *Timeline scales with runway* — 30+ days out you get a 5-stage plan;
    7–29 days it compresses; under a week it switches to "call, don't email"
    urgency. The timeline is converted to **real calendar dates** counting
    back from the event date.
  - *Vendor order matters* — the first vendor is flagged "book first, this
    gates everything else"; the rest say "confirm date, price, and
    cancellation terms in writing."
  - *Context changes the ideas* — the user's vibe/theme and city are woven
    into the built-in ideas, not appended as an afterthought.
- **GenAI is an upgrade, not a crutch** (Prompt Studio). The app builds a
  prompt from the user's context — occasion, city, guest count, budget,
  per-guest spend, days remaining — with explicit constraints ("specific,
  not generic; fit the budget; exactly 3 ideas"). That **exact prompt is
  shown on screen and is editable** before it is sent to Gemini, because
  prompt craft is part of the product. Without a key the planner still
  produces a complete plan offline.

## 3. How the solution works

```
index.html ── form: occasion, date, city, guests, budget, vibe
     │
app.js ────── state + rendering (plans, guests, actual spend → localStorage)
     │
planner.js ── generatePlan() → budget split, dated timeline, vendors, ideas
              budgetTotals() → planned vs spent vs left, live
              guestStats()   → Yes/Maybe/No + expected headcount
              buildIdeaPrompt() → the editable prompt sent to Gemini (optional)
```

1. Fill the form → **Generate my plan** produces budget, timeline, vendor
   checklist, and personalised ideas in one click.
2. **Budget tracker:** type what you actually spent per line; planned /
   spent / remaining update live.
3. **Guest list:** add guests with Yes / Maybe / No; an expected-headcount
   figure (Yes + Maybe) updates live.
4. **Save / share / export:** plans persist in `localStorage`, a share link
   encodes the plan in the URL hash, and a plan exports as JSON.
5. **Prompt Studio (optional):** paste a Gemini API key, edit the prompt if
   you like, run it — Gemini's ideas are added to the list, marked ✨.

**Run it:** open `index.html` in any browser — no build step, no server, no
dependencies. Or `python3 -m http.server 8000` and visit
http://localhost:8000

**Test it:** `node tests/planner.test.js` — checks budget splits sum to the
budget for all three occasions, timeline compression, the dated timeline
ending exactly on the event date, planned-vs-spent maths, guest statistics,
and that the Gemini prompt carries the user's context.

## 4. Evaluation focus — how this project addresses it

- **Code quality:** `planner.js` (pure logic) is separate from `app.js`
  (DOM/state), so the logic is readable, reusable, and testable in Node.
- **Security:** no backend and no stored secrets — the Gemini key stays in
  the user's browser and is only sent to Google's API for that one call.
  All user-entered text (guest names, vibe, city, AI output) is HTML-escaped
  before rendering, so plan content cannot inject markup.
- **Efficiency:** zero dependencies, ~30 KB total, instant load, works
  offline; the GenAI call is optional and user-triggered.
- **Testing:** automated tests in `tests/` (above), plus manual checks of the
  deployed page in an incognito window.
- **Accessibility:** semantic landmarks and real `<label>`s, full keyboard
  operability, a visible `:focus-visible` outline, large touch targets, and
  `prefers-reduced-motion` support.
- **Problem alignment:** budgets, timelines, vendor checklists, and
  personalised ideas for weddings, birthdays, and community events — the
  exact brief — with logic that responds to the user's context (occasion,
  runway, budget size, guest count, vibe, city).

## 5. Assumptions

- Budgets are in ₹ and events are in India (per-guest norms, vendor types,
  and advice like checking venues in person assume that context).
- One device/browser per planner — saved plans live in `localStorage`, not
  an account; the share link is the way to move a plan between people.
- The Gemini key is the user's own; the app never sees or stores anyone
  else's. Built-in ideas are the fallback when there is no key or no network.
- Dates are handled in the user's local timezone (a UTC conversion bug that
  shifted timeline dates by a day in IST was found in testing and fixed).

## 6. Demo (under 4 minutes)

- 0:00–0:30 — The problem: one event = budget + vendors + timeline + guests, in four different places.
- 0:30–1:30 — Fill the form (occasion, date, guests, budget, vibe) → Generate.
- 1:30–2:30 — Budget table: enter a "spent" figure, totals move. Timeline: real dates, compressed because the event is soon.
- 2:30–3:20 — Vendor checklist, guest list with expected headcount, Prompt Studio: show the exact prompt, run it with Gemini.
- 3:20–4:00 — Save the plan, copy the share link, close on who this helps.

## 7. Submitting (Hack2Skill)

1. This repo: public, one branch (`main`), well under 10 MB.
2. Enable GitHub Pages (Settings → Pages → Deploy from branch → `main`) and
   paste the live URL at the top of this README.
3. Record the demo against the **deployed** URL, not localhost.
4. Submit on the Hack2Skill dashboard: repository link + live app URL +
   demo video, before **Sun 1 Nov 2026, 11:59 PM IST**.
