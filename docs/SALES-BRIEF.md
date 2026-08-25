# Harina Bakeshoppe — Sales Brief

Companion to `presentation/harina-proposal.html` (open in a browser; a print-ready
`harina-proposal.pdf` sits beside it). This file is the *working* document: where every
number came from, how to change it, and how to present it.

---

## 1. Where every number comes from

Nothing in the proposal is invented. Sources:

| Figure | Value | Source |
|---|---|---|
| Tray prices | $20 – $65 | `docs/SCOPE.md`, from the client's own requirements PDF |
| Average order value | **$40.63** | Mean of the 8 catalog prices (20,25,30,40,45,50,50,65) |
| Marketplace fee baseline | **15%** | `lib/orders/analytics.ts` — *"the current DoorDash/Uber Eats uplift the owner asked us to compare against."* This is **the owner's own number** |
| Higher marketplace tiers | 25% / 30% | Typical published DoorDash/Uber Eats partnership tiers. **Flag as "confirm against your contract"** |
| Square online processing | 2.9% + $0.30 | Square's published Canadian online/e-commerce rate |
| Labour per manual order | 5 min @ $20/hr loaded | Estimate — answer, write, confirm date, chase payment. Ontario min wage plus burden |
| No-show rate | 3% | Conservative estimate for uncollected prepaid-less pickups |
| Running cost | $69/mo | Vercel Pro $20 + Neon $19 + Resend $20 + Twilio ~$8 + domain ~$2 |
| Build hours | 1,160 – 1,760 | Module estimate against what's actually in this repo |
| Codebase facts | 470 tests, 28,900 LOC, 19 tables, 21 routes | Measured directly from the working tree |
| Reward rate | ~10% back | `lib/orders/pickup-verification.ts`: `points = floor(totalCents/100)`; `lib/accounts/loyalty.ts`: 100 points = $10 off. Redeemed as a Square discount off subtotal, pre-tax |
| Walk-in signup rates | 3% / 6% / 10% | **Assumption.** Presented as a range so the owner picks their own |
| Visits per regular | ~4 / year | **Assumption**, used only to convert transactions into unique people |
| Extra orders per member | 1–3 / year | **Assumption.** The most behaviour-dependent number in the deck — see §3 |

**The one number to be careful with.** 25% and 30% are *typical published rates*, not
Harina's contracted rates. Always say "depending on your plan tier — worth checking your
actual agreement." If they're on a 15% plan, the 15% column is the honest one, and it's
still a compelling story.

### Recomputing after changing an assumption

The scripts that produced these tables are trivial to rebuild. Per-order margin is:

```
direct_fee     = AOV * 0.029 + 0.30
marketplace_fee = AOV * rate
saving_per_order = marketplace_fee - direct_fee
annual_saving    = saving_per_order * orders_per_week * 52
```

At AOV $40.63: direct fee $1.48 (96.4% retained), vs $6.09 at 15%, $10.16 at 25%,
$12.19 at 30%.

---

## 2. The core argument, in one paragraph

Harina already partners with Uber Eats and DoorDash — it's on their own homepage. Those
platforms are fine for discovery, but every repeat customer who orders through them costs
15–30% forever, and the customer's email and order history belong to the platform, not the
bakery. A direct ordering site changes the unit economics on every order it captures
(96.4% retained instead of 70–85%), and it turns one-time marketplace buyers into a
customer list the bakery owns. Party trays are the wedge: they're the highest-ticket items
($20–$65), they're pickup-only anyway, and today they're taken by hand over the phone.

**Break-even is 3.5 orders per week.** Everything past that is margin they weren't keeping.

---

## 2b. The three arguments that actually close this

The commission math opens the conversation. These three close it.

### Walk-ins are the biggest untapped asset

Harina has heavy foot traffic. Every one of those customers cost **nothing** to acquire —
and today every one leaves anonymous. No email, no history, no way to tell them the
Christmas tray menu is up. A marketplace customer is worse: the platform keeps the
relationship *and* charges 15–30% for it.

At 200 walk-ins/day that's 73,000 transactions a year — call it ~18,000 unique people
passing through a shop that cannot contact a single one of them.

### The rewards program is the conversion mechanism

Rewards aren't a nice-to-have; they're the *reason* a walk-in hands over an email at the
counter. "Want $10 off? Join our rewards program." That's the whole transaction. It's
already built: 1 point per dollar, 100 points earns $10 off, points reverse automatically
on refunds.

**The reframe that lands:** on $1,000 of sales you keep **$864** paying your own customers
10% back, versus **$850** on the cheapest marketplace tier and **$700** at 30%. Same money,
completely different outcome — one buys a customer who returns, the other buys nothing.
Say it exactly that way.

The rate is a dial, not a law: 100 points = 10% back, 150 points = 6.7%, 200 points = 5%.
Start generous to build the list, tighten once they're regulars. *(Two constants in
`lib/accounts/loyalty.ts` — a five-minute change.)*

### Ownership is what compounds

Every other number in the proposal moves year to year. This one doesn't. They own the
software, the customer list, the order history, the demand data and the storefront. A
platform owns the customer, sets the commission, controls placement, and can change the
deal. If Harina ever sells the business, an owned ordering system and customer list
transfer with it; a DoorDash account does not.

**Use this to justify Option A** when someone balks at the upfront number — they're not
buying a website, they're buying an asset that replaces a recurring tax.

---

## 3. Honest framing (do not oversell)

Say these things plainly — they make the pitch more credible, not less:

- **This does not replace Uber Eats and DoorDash.** Those platforms bring new customers.
  This captures the repeat ones, at 96.4 cents on the dollar instead of 70–85.
- **Party trays were probably never on the marketplaces** (their site says trays are
  pickup-only). For trays, the win is operational: 24/7 ordering, prepaid so no no-shows,
  capacity-capped so the kitchen never over-commits, and no staff member tied to the phone.
- **The commission savings scale with adoption.** If nobody shifts to direct ordering, the
  savings don't materialise. The loyalty program, email list and reorder button exist
  precisely to drive that shift.
- **Square remains the system of record.** This is not a POS replacement. It feeds Square.
- **The reward is a real cost, not free money.** It's ~10% of gross, paid when customers
  redeem. It's cheaper than commission and it buys repeat business — but never present it
  as costless.
- **Have the 96.4% vs 86.4% answer ready.** Someone sharp will notice the cover says you
  keep 96.4% and the rewards table says $864. Both are true: 96.4% is processing only
  (guest checkout, or a member who hasn't redeemed yet), and the reward is an *optional
  cost you choose* on top. Answer: *"96.4% is what the payment costs you. The 10% is what
  you decide to give back to keep them — and it's still cheaper than the platform."*
- **The walk-in revenue tables assume behaviour change.** Members only generate revenue if
  they actually sign up and actually reorder. Present those tables as *"here's the shape of
  the upside if we execute the counter signup,"* never as a forecast. If they push, drop to
  the +1 order/year row and note it's still five figures.

---

## 4. Twelve-minute talk track

1. **Open with their own question** (30s) — *"Your brief asked nine questions. Let me show
   you all nine working."* Pull up the staff dashboard, place a test order, let the chime
   ring. Nothing sells this like the order appearing live.
2. **The math slide** (2 min) — $39.15 vs $34.53 vs $28.44 on the same $40.63 tray. Let
   the three numbers sit. Then: *"Which one of those is your business?"*
3. **The annual table** (2 min) — ask them to point at their own row. Don't guess their
   volume for them; let them claim it. Whatever they pick, the number is theirs now.
4. **What commission math misses** (1 min) — staff time and no-shows. Often the part the
   owner feels most, because it's the part that hurts during service.
5. **The walk-in question** (2 min) — ask it, don't tell it: *"How many people come
   through the door on a Saturday?"* Let them say the number. Then: *"How many of them can
   you email on Monday?"* The silence is the pitch. Follow with the $864-vs-$850-vs-$700
   table — you'd rather pay your customer 10% than a platform 30%.
6. **Feature tour** (2 min) — don't read the list. Show three things: pause ordering with
   one tap, mark an item sold out for today, and the fees-avoided counter in analytics.
7. **Why it won't break** (1 min) — 470 automated tests, duplicate-charge protection,
   keeps working if Square goes down. Small businesses have been burned by fragile
   software; this is the reassurance slide.
8. **Ownership** (1 min) — the part that compounds. They own the software, the list, the
   data. A platform owns the customer and sets the rate. This is the emotional close for an
   owner-operator: after three years you hold something, not a cancelled subscription.
9. **Replacement cost, then price** (1 min) — show $215k–$326k first, *then* the options.
   The anchor does the work. Never lead with the price.
10. **Close on the 3-year table** (30s) — $20,604 all-in vs $38,030–$76,059 in commission
   on the same sales, and they own the customer list at the end.

---

## 5. Objection handling

| Objection | Response |
|---|---|
| *"We're happy with Uber Eats."* | Keep them. This isn't a replacement — it's where your repeat customers go, at 96.4% instead of 70–85%. Uber Eats finds you customers once; this keeps them. |
| *"Our customers won't use a website."* | They already do — they use Uber Eats' website. This one just doesn't charge you a quarter of the ticket. And the phone still works. |
| *"That's a lot of money for a bakery."* | Break-even is 3.5 orders a week. Below that, don't buy it. Above it, it pays for itself and keeps paying. Here's the payback table — pick your row. |
| *"What if it breaks on a Saturday?"* | 470 automated tests run on every change. If Square goes down the kitchen screen keeps working. If a payment result is unclear it recovers itself instead of guessing. And under the care plan, that's my problem, not yours. |
| *"Can we start smaller?"* | Option C: $2,500 up front, $495/month, cancel with 60 days' notice. Lowest risk way to find out if your customers order direct. |
| *"Who owns it if we stop paying?"* | Option A you own it outright day one. Option B ownership transfers at 12 months. Option C is a service — you keep your data and customer list either way, always exportable. |
| *"Can you add delivery later?"* | The architecture supports it. Today it's pickup-only because that's what your brief asked for and what trays need. |
| *"Won't 10% rewards eat our margin?"* | You're already paying 15–30% on marketplace orders for nothing. This 10% goes to your own customer and only costs you when they come back and spend again. And it's a dial — we can set it to 6.7% or 5% any time. |
| *"Our walk-in customers won't sign up."* | You don't need most of them. At 200 walk-ins a day, even a 3% signup rate builds 548 members in a year. If each orders two trays, that's $35,000 you had no way to ask for. |
| *"What if we want to stop the rewards program?"* | It's your program — you set the rate or wind it down. Outstanding points are a liability you control, unlike a commission rate somebody else sets. |
| *"We already have their email from Square."* | Square has transaction emails, not permission to market and no order-history-driven reorder. This gives you an opted-in list, a reason for them to return, and one-tap reordering. |

---

## 6. Pricing rationale

Replacement cost at boutique-agency rates is **$215k–$326k**. The system exists, tested and
deployed, so the ask is a fraction of that. Three packages, calibrated so each is clearly
cheaper than the value it delivers at realistic volume:

| | Setup | Monthly | Break-even volume (vs 15%, steady state) |
|---|---|---|---|
| **A. Buy outright** | $16,500 | $0 (they pay ~$69/mo infra) | 0 — owned |
| **B. Launch & care** *(recommended)* | $7,500 | $295 | ~9.5 orders/week |
| **C. Fully managed** | $2,500 | $495 | ~15.5 orders/week |

**Why B is the recommendation:** it splits the risk. Low enough upfront that the decision
isn't painful, recurring enough to fund real maintenance (Square deprecates APIs; someone
has to handle that), and ownership transfers at 12 months so it never feels like a trap.

**If they push back on price**, the lever is the setup fee, not the monthly. The monthly
funds ongoing work; discounting it creates a support obligation you can't afford to honour.

---

## 7. What to have ready before the meeting

- [ ] The live demo running (`npm run demo`) — or the staging site, with a location chosen
- [ ] A test order you can place live so the dashboard chimes in front of them
- [ ] The analytics page open on the **fees avoided** panel
- [ ] `presentation/harina-proposal.pdf` on a tablet, and printed if they're a paper business
- [ ] Their actual Uber Eats / DoorDash contract rate, if you can get it beforehand — it
      makes the whole conversation concrete instead of hypothetical
- [ ] **Their rough walk-in count per day** — ask early, ideally before the meeting. Every
      walk-in and rewards table keys off it, and a number they gave you is unarguable
- [ ] A mocked-up counter card ("Join rewards — $10 off") — makes the signup motion
      concrete instead of theoretical

---

## 8. Known gaps to disclose

Do not let them discover these later:

- The system has processed **sandbox payments only**. First live payment happens during
  launch week. (`docs/RELEASE-GATE-A.md` documents the full verification checklist.)
- **Apple Pay needs a one-time domain registration** with Square before the button appears.
- Product photography currently comes from Square. If their Square catalog has no photos,
  the site shows branded fallback tiles until photos are added.
- The 512px app icon is upscaled from their badge artwork and should be replaced with a
  designer original before any marketing push.
