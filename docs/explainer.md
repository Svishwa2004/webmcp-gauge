# webmcp-gauge — The Idea in Plain Language

**For:** a reader with no technical background
**Written:** 2026-08-29 · **Updated:** 2026-09-01 (a day-apart re-test, and the first look inside a real assistant's browser)
**Companion document:** `concept.md` (the technical version)

---

## The short version

A brand-new web technology lets websites hand AI assistants a set of labelled buttons they can press directly, instead of making the assistant squint at the screen and guess. It is early, it is promising, and it has one glaring hole: **when you install those buttons on your website, there is no way to find out whether any AI assistant ever presses them.**

We are building the thing that tells you. Not a website that uses the technology — a tool that measures whether the technology is working for you.

---

## First, what the new technology actually does

Think of a website as a shop.

A human customer walks in, looks around, reads the signs, and finds the till. That works because humans are good at looking at things.

When an AI assistant "uses" a website today, it is doing something closer to a courier wandering the aisles trying to work out where the till is by reading everything on every shelf. It mostly works, slowly, and it breaks whenever the shop rearranges a display.

The new technology — called WebMCP — lets the shop put up a **staff counter for couriers**, with a short printed menu of things it will do on request: *check stock*, *place an order*, *print a receipt*. The courier walks straight up and asks. No wandering, no guessing, no breaking when the shelves move.

That is the whole idea, and it is genuinely a good one. Websites get to decide exactly what an assistant is allowed to do, in plain terms, instead of having assistants poke at the screen and hope.

---

## The hole in the middle of it

Here is what actually happens when a developer installs that counter today.

They build it. They write the menu. They publish it. And then… nothing. No confirmation. No receipt. No way to tell whether an assistant ever walked up to the counter, whether it read the menu, whether it understood the menu, or whether it strolled past and went back to wandering the aisles.

This is not a hypothetical. One developer reported getting an assistant to use their counter **once in twenty attempts** — and got the same result with the official demonstration examples. Another spent days debugging by taking screenshots inside the assistant's browser, because screenshots were the only evidence available to them. A third put 296 items on their menu, and the entire feature silently switched itself off — no warning, no error message, nothing.

That third story is worth pausing on, because we have since tested it. We put **507** items on a menu in the current version of Chrome and every one of them worked. So either that developer's browser was different from ours, or something else was going on — and *nobody could have told you that before somebody measured it.* Which is the point of the whole exercise: the folklore in this field is untested, and some of it is wrong.

The reason this matters more than it sounds: **the menu wording is the product.** The assistant decides what to do by reading the labels. So a shop can have a perfect counter, perfect staff and perfect stock, and still fail entirely because the sign above the counter is ambiguous. It is an airport-signage problem, not a plumbing problem. And nobody can currently measure their own signage.

---

## What we are building

A rehearsal, run automatically.

Imagine hiring twenty mystery shoppers. Each one wants the same thing, but each phrases the request differently — "how much did I spend last month", "summarise my spending", "what's my monthly total". You send them in one at a time and record exactly what happened to each one.

At the end you get a scorecard:

> Of 20 people who wanted a spending summary: 7 were served correctly. 11 were ignored — the assistant answered from memory instead of using your counter. 2 went to the right counter but filled in the form wrong.

That single number — how often a realistic request actually reaches the right counter — is the thing nobody measures today. We are calling it the **invocation rate**, and naming it is part of the point: you cannot improve something the industry has no word for.

The rest of the scorecard matters just as much, because it tells you *which* thing to fix. "Ignored" means your wording is weak. "Wrong counter" means two of your labels look too alike. "Wrong form" means your request form asks for the wrong things. Today, all three failures look identical from the outside: nothing happened.

Three practical pieces, built in this order:

1. **A free checker** that reads your menu and flags obvious mistakes — labels that break the rules, two labels that mean the same thing, forms that ask for too much. No AI needed, runs in seconds. *Built.*
2. **The rehearsal itself** — the mystery shoppers, producing the scorecard. *Built. It has now been run 4,040 times against real pages in a real browser.*
3. **A public record** of which assistants and browsers actually behave which way, kept up to date as they change. This is the part that outlives everything else. *Twelve runs published so far, each with the code that produced it.*

---

## Why the number needs to be honest, not just impressive

AI assistants are not machines that give the same answer twice. Ask the same question on Monday and Thursday and you can get different behaviour.

So a single test proves nothing, and a confident-looking percentage with no error margin is close to a lie. Every number we publish therefore comes with how many attempts it is based on, how much it wobbled between runs, and exactly which assistant and browser version produced it — the way a rainfall figure is meaningless unless you say how long you left the bucket out.

This sounds like a technicality. It is actually the entire product. Anyone can publish a percentage. The reason to trust ours is that we publish the wobble alongside it, before anyone asks.

And there is a hard commitment attached: if the first round of measurement shows the numbers wobble so much that they carry no real signal, we say so publicly and stop, rather than dressing up noise as insight. A measuring instrument that flatters is worse than none.

---

## Why do this now, when almost nobody uses the technology?

Because almost nobody uses it *yet*.

An independent scan of 111,000 of the world's most popular websites earlier this year found **zero** of them using this. Apple has formally objected to the technology. Mozilla, who make Firefox, are neutral. Google has it switched on only as a time-limited experiment and has not committed to keeping it. This might become how the whole web talks to AI, or it might quietly disappear.

That uncertainty is exactly why the timing works. There is no money in this in 2026 — there is nobody to sell to. What there *is*, is an empty seat.

Every technology that matters ends up with someone independent doing the measuring. Cars have crash-test ratings, and the organisation that publishes them is not a car manufacturer — but it shapes what manufacturers build. Food has nutrition labels. Websites have search-visibility tools that firms pay for every month to find out how Google sees them.

This technology has no crash-test rating yet. Being the one that defines it is worth more, right now, than being one more website using it.

There is also a second beneficiary, and it is the technology itself. The committee designing this standard is arguing about real questions — how many menu items are too many, why it behaves differently in different browsers, whether its safety labels do anything at all — and they are arguing almost entirely without evidence. We will produce that evidence and hand it over. If it turns out that these counters mostly *don't* get used, that is a design problem the standard needs to know about now, while it can still be fixed.

---

## Who benefits, concretely

| Who | What they get |
|---|---|
| A developer who installed this on their site | A number before they launch, and a specific reason it is low — instead of guessing |
| A business considering it | An honest answer to "will AI assistants actually be able to use our site, or is this a waste of a quarter?" |
| The people designing the standard | Evidence instead of anecdotes, on questions they are currently guessing at |
| Us | The position of the independent measurer, in a field where that seat is empty |

---

## How this could eventually make money — and why it doesn't yet

Deliberately, there is nothing to buy at first. No pricing page, no accounts. The checker is free, the data is public.

The route to revenue, if the technology takes hold, is the one the search industry already walked. Firms pay monthly today to find out how Google sees their website. If AI assistants become a serious way people reach businesses, those same firms will pay to find out whether assistants can actually *use* their website — and to be told the moment a redesign quietly breaks it.

That is a 2027 conversation at the earliest. Building a checkout page in 2026 for a market with zero customers would be theatre.

---

## What could go wrong

**The technology doesn't catch on.** Real risk — Apple objects, Google hasn't committed, adoption is currently zero. The protection is that our actual question — *did the assistant use the thing we offered it, and did it use it correctly?* — is not specific to this technology. AI assistants will be given tools by websites, apps and operating systems one way or another, under some name. The measuring instrument survives the name change.

**The measurements turn out to be noise.** Addressed above: we publish the wobble, and we stop rather than sell a number we don't believe.

**Someone bigger builds it.** Google already gives away a basic version of part of this. The answer is not to compete with a free tool from Google, but to do the things it doesn't: compare across *different* browsers and assistants, be strict about statistics, catch it automatically every time a developer changes their code, and publish the results openly.

**Nobody cares yet.** Likely, for a while. Hence keeping the first version small, free and cheap to run.

---

## Where things stand

**The instrument works, and the first hard question has been answered.**

There is a finished website of our own using this technology, with seven working counters — the equivalent of a calibration weight for a set of scales. The rehearsal runs against it end to end: it opens its own browser, reads the menu, asks an AI which counter it would use, checks the answer, presses the button and checks that something actually happened.

The first milestone was deliberately falsifiable: does the number hold still enough to be worth anything? **It does.** Run the same rehearsal three times in three separate browsers and the results move by around one to nine parts in a hundred — while the differences we are trying to detect are thirty-five to seventy-five parts in a hundred. The signal is far larger than the wobble, which is the only reason any of the rest is worth saying.

The second question was harder and more important: *does a good score actually mean good signage, or does it just mean the machinery ran?* To find out, we built a deliberately badly-signed copy of our own shop — same stock, same staff, same counters, only the signs rewritten badly — and sent the same twenty shoppers per counter into both. The good copy served 99.3% of them. The bad copy served 83.1%, and its two worst counters dropped to 60% and 27%. So the instrument measures the signs, not itself.

Then the genuinely surprising part. We took the bad signs apart to find out which specific mistake did the damage, and **no single mistake did it.** A vague sign on its own cost 5 points. A second counter with an identical sign, on its own, cost 3. Both together cost **35** — far more than the sum. Bad signage compounds: two individually harmless problems become one serious one. That is not what we predicted, we wrote our predictions down before running the test, and two of them were wrong. Those wrong predictions are published alongside the right ones, because a measuring project that only reports its hits is not measuring.

Three smaller findings, all of the same shape — folklore that turned out to be untrue when tested:

- A counter whose name contains a space was said to fail silently. In the current Chrome it does not fail silently; it is rejected outright, with an error.
- 296 menu items was said to switch the feature off. 507 items did not.
- A menu item added by an embedded widget — an advert, a chat box, anything in a frame — turns out to appear on *the host shop's* menu. Worth knowing if you embed other people's widgets.

**What is still missing** is the part that matters most commercially and is hardest to get: none of this has been measured inside a real AI assistant *making the choice* yet. Everything so far uses a stand-in — a language model asked the same question a real assistant would be asked. Whether the stand-in predicts the real thing is the one assumption the whole product rests on.

The first half of that has now been done, and it is worth stating precisely because it is easy to overclaim. The ChatGPT desktop app has its own browser built into it. We can now open our own shop *inside that browser*, under our own control, and confirm that the seven counters are visible to it exactly as they are in ordinary Chrome — so the real product can see what we thought it could see.

The second half was attempted on 2026-09-02, and it failed in an instructive way. We asked the real assistant a real question with our shop open in its own browser, and nothing happened — because **that is not the window the assistant looks through.** It reads pages through an extension attached to the user's *everyday* Chrome, not through the browser inside its own app. Reaching it properly would mean opening a personal browser up to remote control, and that price was judged too high for the answer.

So the honest position, which every number here carries: nobody has yet watched a real assistant walk up to one of these counters. The stand-in is a good one, and whether it predicts the real thing remains an open question rather than a settled one.

**What success looks like, in one sentence:** when a developer somewhere hits this problem and searches for whether these things actually get used, the number they find and quote is ours.
