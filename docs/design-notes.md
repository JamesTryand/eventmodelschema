# Design notes — eventmodeling.schema.json v1

Decisions made while drafting the schema, and why, for whoever touches this next.

## Structural validation vs. methodology validation are two separate gates

The schema enforces only that a document is *well-formed*: every slice has the
fields its `pattern` requires, every scenario's `kind` matches what its slice allows,
ids look like ids. It deliberately does **not** enforce the EventModeling "20 Rules"
— e.g. "every command has a reason," "every read model answers a question," or the 4
anti-pattern cardinality checks (one Command/Read Model fanning to too many Events,
one Screen driving too many Commands, a slice with no scenarios while its siblings
have some).

Why: those rules describe a *finished*, reviewed model — not a well-formed document.
A command without a reason isn't malformed, it's incomplete, and an authoring tool
needs to be able to save incomplete/in-progress models (that's exactly when
structural validation matters most — a draft still needs to parse). Making `reason`/
`question` schema-required would also train people to write `reason: "TODO"` just to
pass validation, which satisfies the schema while defeating the entire point of the
rule — the design conversation the rule exists to force never happens.

Instead: keep methodology checks as a **separate lint, run at a later gate** (e.g.
merge/publish, not parse) where the review is meaningful because it happens at a
moment someone actually cares (shipping/merging), while drafting stays fluid. This
schema does not implement that lint — it's a future companion tool's job.

Concretely, in this schema: `Command.reason` and `ReadModel.question` are optional;
no `maxItems` appears anywhere an anti-pattern needs to stay observable
(`Slice.eventIds`, `ReadModel.builtFromEventIds`, `Slice.scenarios`); and there is no
attempt to verify that ids referenced by `swimlaneId`/`eventIds`/`readModelId`/etc.
actually resolve to an entry in the corresponding registry (JSON Schema has no
cross-property lookup keyword for this anyway).

## Flat, id-keyed registries instead of nesting

Events, Commands, Read Models, Screens, and Automations are each a top-level object
keyed by id (`events: {"order-placed": {...}}`), not embedded inside the slices that
use them. Slices reference them by id string.

Why: the same event legitimately appears in multiple slices — that's exactly what
the fan-in/fan-out anti-patterns are measuring. Nesting would force either duplicate
definitions (which drift) or picking one "owning" slice arbitrarily. Using the id as
the *object key* (rather than an `id` field inside array items) gets uniqueness
enforcement for free via `propertyNames` + `additionalProperties`, and keeps the
identifier in exactly one place — which also directly serves a future
`eventmodeling-change-sync` consumer: renaming is just changing `name`, the id/key
never moves.

`slices` and `swimlanes` are the two exceptions that stay as ordered arrays — their
position is part of the model's meaning (time flows left→right for slices; swimlane
stacking order is part of the diagram), unlike events/commands/etc. which have no
intrinsic order.

Cross-references always point child→parent (`Event.swimlaneId`, `Slice.chapterId`,
etc.), never the reverse — one source of truth, no membership lists to keep in sync.

## `allOf` + `if`/`then`, not `oneOf`, for pattern-specific shapes

Both `Slice` (4 patterns) and `Scenario` (4 kinds) have a base shape plus fields that
depend on a discriminator (`pattern` / `kind`). This is implemented as `allOf` of the
base schema plus one `if`/`then` block per discriminator value, with a single
top-level `unevaluatedProperties: false`.

**Do not** rewrite this as `oneOf` with per-branch `additionalProperties: false` —
each `oneOf` branch is evaluated independently and can't see the shared base
schema's properties, so a valid document (which legitimately has both the base
fields and the pattern-specific ones) fails every branch and the whole `oneOf`
fails unpredictably. `allOf`/`if`/`then` + `unevaluatedProperties` is the correct
2020-12 idiom for "shared base + discriminated extension."

## Translation is a first-class 4th scenario kind, not folded into the others

The cheat sheet lists State Change / State View / Automation / Translation as four
patterns on equal footing (rule #7), but only describes 3 scenario shapes (State
Change / State View / Error) — none of which fit Translation, since it has no
Command or Query, just `Event(s) → Read Model → Event(s)`.

Resolved by adding a 4th scenario `kind: "translation"` whose `when` slot holds a
single **event reference** — the triggering event's arrival — rather than a command
or query reference. `given` and `then` reuse the same event-list shapes as
`stateChange`. Translation slices do not get an `automationId`: translation reads as
passive data-mapping across a boundary (e.g. between swimlanes), not a system
"side-effect" the way the `automation` pattern's gear icon represents.

## Slice status has a conventional default, not a schema default

`status` is required on every slice (no schema-omittable), but `"created"` is
documented as the value an authoring tool should pre-fill for a brand-new slice —
that's a UX convention, not something JSON Schema's `default` keyword can enforce
(it only affects generation/documentation tooling, not validation).

## Deliberately excluded from v1

- **The UI-only "screen after screen" walkthrough notation** from the cheat sheet
  ("show UI-only interaction by just showing one screen after the other — no
  commands, events"). It touches none of the 5 elements this schema models — it's
  arguably `eventmodeling-tooling`'s prototyping-GUI concern, not a *document*
  schema concept. Tracked as a deliberate exclusion in the root `NEEDS.md`, not an
  oversight.
- **Referential-integrity checking and anti-pattern detection tooling.** Both need a
  companion script/linter operating on a parsed document, not schema keywords.
- **Multi-file `$ref` splitting.** Single file is plenty at this size; revisit if
  `$defs` grows substantially — revisited in v2, see below.

## v2: typed fields (M1)

v1 deliberately left Event/Command/ReadModel payloads untyped (`data`/`queryParams`/
`result` in scenarios were free-form objects). Comparing against Nebulit's official
`event-modeling-spec` (the schema behind their actual tooling product) showed this
was the single biggest completeness gap for real codegen use — their `Field` type
(name/type/optional/cardinality/subfields/`idAttribute`/`pii`) lets a generator emit
real typed DTOs, flag PII for redaction, and identify the key/id field. A separate
architecture reference doc's framing of "Contracts (Events/Commands/DTOs) shared
between services as independently-versioned packages" reinforced that payload
typing is a first-order concern for the code these documents are meant to generate.

Added a `field` `$def` (name/type/description/optional/cardinality/`idAttribute`/
`pii`/recursive `subfields`) and an optional `fields` array on `event`, `command`,
and `readModel` definitions only (not `screen`/`automation` — those aren't
data-bearing per the methodology). Deliberately narrower than Nebulit's `Field`:
skipped their `example`, `mapping`, `technicalAttribute`, `generated`, `schema`
properties for now — nothing currently consuming this schema needs them, and they
can be added later without breaking anything, since `fields` is optional throughout
(a v1 document with no `fields` anywhere stays valid unchanged).

Type enum values are lowerCamelCase (`string`, `boolean`, `integer`, `long`,
`decimal`, `double`, `date`, `dateTime`, `uuid`, `custom`) rather than Nebulit's
PascalCase, to match this schema's existing casing convention throughout — a
deliberate style divergence, not an inconsistency.
