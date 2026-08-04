# EventModeling methodology notes (non-schema)

Reference material originally from `resources/event-modeling-cheat-sheet.pdf`, kept
here for context since it informed the schema design but doesn't map to any schema
field directly — these describe how to *run a workshop*, not the shape of a
*document*. Vendor tooling/branding (app.eventmodelers.ai, `@eventmodelers/*` npx
kits, book/course/podcast links) is intentionally omitted — not this project's
concern.

**Note on sourcing (v2):** the cheat sheet turned out not to be the canonical
source, and contains at least one real error (its "Translation" pattern — see
below and `docs/design-notes.md`). It's kept here as a useful, if imperfect,
workshop-facilitation reference, cross-checked where it matters against Adam
Dymitruk's own article (<https://eventmodeling.org/posts/what-is-event-modeling/>)
and a canonical worked blueprint (`eventmodeling_blueprint_large.jpg`, attributed to
Adam Dymitruk — kept private in the issue worktree, not redistributed here, same
policy as the cheat sheet PDF).

## The Workshop (6 steps)

1. **Brainstorming** — goal: collect all events. Ask "what's the first? what's the
   last event?"
2. **The plot** — goal: find the story. How information flows.
3. **Storyboarding** — goal: common understanding.
4. **Input / Output** — goal: understand information flow.
5. **Swimlanes** — goal: understand ownership. Swimlanes can be Teams or Systems;
   they indicate ownership of Events (data).
6. **Scenarios** — goal: understand business rules. Ask 3x: "is there any rule we
   didn't cover?"

## 10 Facilitation Rules

1. Every Event Modeling session needs a facilitator.
2. Set a clear context before inviting.
3. Invite the right people.
4. Don't focus on technology / implementation.
5. Don't get stuck in discussions.
6. Don't waste time beautifying the model in workshops.
7. Never leave questions unanswered.
8. Start small — Event Modeling is exhausting.
9. Event Modeling is primarily a communication tool.
10. Keep it simple.

## The 20 Rules of Event Modeling

1. Start with events.
2. Model facts, not ideas.
3. Time flows left → right.
4. If the order is unclear, create a hotspot.
5. Name by intent.
6. Use only four patterns.
7. State Change • State View • Automation • Translation. **Correction (v2):** this
   schema implements only 3 patterns — `translation` is not a distinct shape; see
   "Primary-source cross-check" below and `docs/design-notes.md`.
8. Every command has a reason.
9. Never add commands "just because."
10. Every Read Model answers a question.
11. No question, no Read Model.
12. Don't guess.
13. Unknowns become hotspots.
14. Keep slices small.
15. One business capability per slice.
16. Keep it simple.
17. Complexity usually hides a problem.
18. Optimize for conversation.
19. Shared understanding beats pretty diagrams.
20. Model behavior, not structure.

The most important question to ask, throughout: **"What happens next?"**

Rules 8–11 and the 4 anti-patterns below are exactly the ones this schema
deliberately does *not* enforce structurally — see `docs/design-notes.md` for why,
and treat them as a future lint/review concern instead.

## 4 Anti-patterns (things to watch, not forbid)

- **"left chair"**: one Command fanning out to many Events — usually signals a slice
  that's too coarse.
- **"right chair"**: one Read Model fed by too many Events — same issue, other side.
- **"bed"**: one Screen driving many Commands.
- **"shelf"**: a slice with zero scenarios when every other slice has some.

> "Those patterns are not red flags, but something to keep an eye on. I first look
> for them on every model."

## Notations not carried into the schema

- **UI-only screen walkthrough**: showing one screen after another with no
  commands/events, for pure UI prototyping. Excluded from this schema — see
  `docs/design-notes.md`.

## Primary-source cross-check: the canonical cycle (v2)

Dymitruk's article and the canonical blueprint describe one circular flow, not four
independent patterns: **Command → State** (applied) → **State → Event** (decide/
evolve) → **Event → ViewModel** (projection) → **ViewModel → Command** (a new
decision informed by what's been seen). A View/ReadModel is only ever a sink for
events and a source for commands — never a source of events directly. Quoting the
article directly: *"the views are passive and cannot reject an event after it's
been stored in the system."*

The canonical blueprint's own legend gives four worked Given/When/Then examples,
under different names than the cheat sheet:

- **State Change**: Given `[Registered, Room Added]` → When `[Book Room]` → Then
  `[Room Booked]`.
- **State View**: Given `[Paid, Paid]` → Then `[Sales Report]` (no command at all —
  pure projection).
- **External State Input** (the blueprint's name for what the article calls
  Translation): Given `[GPS Update ×4]` → When `[Translate To Location]` **(a
  Command)** → Then `[Entered Hotel, Exited Hotel]`. No View/ReadModel anywhere in
  this shape.
- **External State Output** (the blueprint's name for the article's Automation):
  Given `[Stay Notifications to Send]` (a View) → When `[Send Notification]` (a
  command) → Then `[Notification Sent, Notification Failed]`. Matches the article's
  own explicit example verbatim: *"Given: A view of the tasks to do, When This
  command is launched for each item, Then These events are expected back."*

So "Translation" and "Automation" are the same two patterns under two vocabularies
(EventModeling article vs. blueprint diagram labels) — and neither is drawn with a
View producing an Event directly. The cheat sheet's `Translation` diagram (`Event →
Read Model → Event`, no Command) doesn't match either source. This schema
implements the corrected shape: `automation` covers both cases (`Event(s) →
[optional Read Model] → Command → Event(s)`), with "Bridge"/"Translation"/"Reactor"
surviving only as documented, derived classifications (by trigger-event
provenance), not separate schema mechanics — see `docs/design-notes.md`.
