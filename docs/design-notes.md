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

Both `Slice` (3 patterns) and `Scenario` (3 kinds) have a base shape plus fields that
depend on a discriminator (`pattern` / `kind`). This is implemented as `allOf` of the
base schema plus one `if`/`then` block per discriminator value, with a single
top-level `unevaluatedProperties: false`.

**Do not** rewrite this as `oneOf` with per-branch `additionalProperties: false` —
each `oneOf` branch is evaluated independently and can't see the shared base
schema's properties, so a valid document (which legitimately has both the base
fields and the pattern-specific ones) fails every branch and the whole `oneOf`
fails unpredictably. `allOf`/`if`/`then` + `unevaluatedProperties` is the correct
2020-12 idiom for "shared base + discriminated extension."

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

## v2: `translation` removed; `automation`'s `readModelId` made optional

v1 had a 4th slice pattern and scenario kind, `translation` (`Event(s) → Read Model
→ Event(s)`, no command), taken from the cheat sheet's "4 Patterns." It's removed in
v2. Reasoning, worked out over several rounds of checking against primary sources
rather than the cheat sheet alone:

- **The cheat sheet is not the canonical source and contains an error here.** The
  user supplied two more authoritative materials: `architecture.drawio.pdf` (a CQRS/
  event-sourcing reference deck) and `eventmodeling_blueprint_large.jpg` (a worked
  example blueprint attributed to Adam Dymitruk, EventModeling's originator), plus
  Dymitruk's own article (<https://eventmodeling.org/posts/what-is-event-modeling/>).
  None of these support `Event → Read Model → Event` as a real shape.
- **Dymitruk's cycle has no ViewModel→Event edge.** The canonical cycle is
  Command→State (applied), State→Event (decide/evolve), Event→ViewModel
  (projection), ViewModel→Command (a new decision informed by state). A View/Read
  Model is only ever a sink for events and a source for *commands* — never a source
  of events directly. The article states outright: "the views are passive and cannot
  reject an event after it's been stored in the system" — and, more tellingly, no
  worked example anywhere in the article or the blueprint shows a View producing an
  Event without an intervening Command.
- **The article's own "Translation" pattern has no stated mechanism**, just a
  motivating example (translate GPS coordinates into "Guest left hotel"/"Guest
  returned to hotel room") — it never specifies Event→ReadModel→Event. The
  blueprint's own worked version of that *exact* example ("Hotel Proximity
  Translator") shows an explicit **Command** ("Translate To Location") mediating
  between the input GPS events and the resulting events — i.e. `Event(s) → Command →
  Event(s)`, the same shape as `stateChange`, just automated and boundary-crossing.
- **The architecture deck's independent "Commands & Events differentiation"
  principle agrees**: Commands are rejectable (not yet historical); Events are
  historical facts and cannot be rejected. A pattern that skips the Command step
  removes the one thing that made the resulting Event's production a *decision*
  rather than an unconditional pass-through.
- Given that, `translation` never had a distinct GWT shape at all — it's exactly
  `automation` (`Event(s) → [Read Model] → Command → Event(s)`), differing only in
  *why* it exists (adapting an external/foreign vocabulary) rather than *how* it's
  structured. "Translation," "Bridge" (the architecture deck's term for the same
  thing — "similar to the denormalizer, however its purpose is to bridge events from
  other services and map them to commands within this service"), and "Reactor" (an
  informal general label) are three names for the same shape from three different
  vocabularies, not three different patterns.
- Also, comparing Nebulit's *official, shipped* `event-modeling-spec` (as opposed to
  their cheat sheet) — it has no `TRANSLATION` sliceType either. What was originally
  read as a gap in their product turned out to be evidence the pattern doesn't hold
  up in practice, not an oversight.

**Concretely**: `translation` removed from `slicePattern` and `scenarioKind`; the
`sourceEventIds`/`targetEventIds`/`readModelId`-required slice shape and the
`when: eventRef` scenario shape are gone. `automation`'s `readModelId` changed from
required to optional — the fix that actually keeps `automation` itself honest: many
real automations (particularly boundary-crossing "Bridge" ones) are stateless,
straight `Event(s) → Command → Event(s)`, and forcing a Read Model onto them was the
same mistake `translation` made, just softer (an unnecessary field rather than a
missing Command). `automationId`/`triggerEventIds`/`commandId`/`resultEventIds`
stay required — an automation always needs a Command mediating its output.

"Bridge" (boundary-crossing: an automation's `triggerEventIds` are owned by a
different `swimlaneId` than the slice's own) stays a **derived, documented
classification** of `automation`, not a stored field or a separate pattern — same
reasoning as not storing Nebulit-style `INBOUND`/`OUTBOUND` dependency records:
it's mechanically computable from data already in the document.

## v2: `aggregate` on Event/Command (not `streamId`)

Originally planned as a `streamId` hook (rest of M2), renamed after clarifying what
was actually needed. Two distinct concepts were being conflated:

- **Instance identity** — e.g. `order-123`. In event-sourcing systems this is
  usually the same value under two names: "aggregate ID" (domain-modeling
  vocabulary) and "stream ID" (storage vocabulary, since one stream commonly *is*
  one aggregate instance's event log). This is runtime **data**, not schema
  metadata — and it's already covered: M1's `idAttribute: true` flag on a `Field`
  marks exactly this.
- **Type classification** — "this Command/Event definition targets aggregate-type
  `Order`," independent of any one instance. This is genuinely a static property of
  the *definition*, comparable to Nebulit's `aggregate` (string) field.

`streamId` was the wrong name for the second concept: it implies instance-level
data (already handled by `idAttribute`), and it imports an ESDB-flavored assumption
("stream" as a first-class primitive) that doesn't fit Kafka, which has no "stream"
entity at all — just topics and partition keys. A storage-agnostic type-level tag
lets a codegen tool decide independently whether that becomes one Kafka topic, one
ESDB stream category, or something else; the instance-level partition
key/stream name still comes from the `idAttribute`-flagged field, not this tag.

Added optional `aggregate` (string) to `event` and `command` definitions only —
not `readModel` (typically cross-cutting, spans multiple aggregates by nature) or
`screen`/`automation` (not domain concepts in this sense). Not every
Command/Event needs one: a boundary notification like `Notify Shipping Partner` /
`Shipment Notified` isn't targeting a domain aggregate at all, and the worked
example leaves those untagged deliberately.

## v2 M3: multi-file composition layer

A single document is fine at example scale but doesn't stay so as a real model
grows — and Nebulit's per-slice-file approach (each slice a standalone file) was
the direct comparison point that started this. Their approach duplicates full
element definitions into every slice that uses them, because they split by slice
*without* first solving element identity; we didn't make that mistake in v1 (flat
id-keyed registries, single definition per id), so splitting and rejoining our
documents can be lossless where theirs can't.

**Key decision: this needed no change to the document schema's logical shape at
all.** `eventmodeling.schema.json` still validates exactly the same single-document
shape it always has. What's new is a **manifest** (`manifest.schema.json`) plus a
**pure, mechanical split/join transform** (`scripts/split.js`, `scripts/join.js`)
layered on top:

- The manifest owns `swimlanes`, top-level metadata, which file holds each
  non-empty registry, and — critically — the **ordered list of slice file paths**.
  Order lives in exactly one place. It is *not* reintroduced as a per-slice `index`
  field, which would recreate the dual-source-of-truth flaw already identified in
  Nebulit's schema (`Slice.index` *and* array position, able to disagree).
- Slice files and registry files are referenced by **explicit path**, not
  discovered by filename convention. This is what makes arbitrary reorganization
  free: someone can lay slice files out flat, grouped by swimlane, grouped by
  pattern-role (`slices/bridge/`, `slices/denormalizer/`, etc. — a real idea raised
  during design, folding automations by whether their `triggerEventIds` cross a
  swimlane boundary), or any other scheme, and the manifest just points at wherever
  they ended up. No classification logic needed in the tooling itself for this.
- `join.js` reassembles a manifest + its referenced files into exactly the shape
  `eventmodeling.schema.json` validates, including re-stamping the top-level
  `$schema` pointer (read from the canonical schema's own `$id`, not duplicated) —
  a joined document is always meant to validate against that schema, regardless of
  whether the manifest itself declares one. `split.js` is the exact inverse.
- `scripts/roundtrip-check.js` proves the two are true inverses: split a known-good
  document, join it back, deep-compare (`assert.deepStrictEqual` — order-independent
  for objects, order-preserving for arrays, which is what's wanted for `slices`/
  `swimlanes`) against the original. Both worked examples pass (`npm run roundtrip`).
- `manifest.schema.json` validates only the manifest's own skeleton (paths,
  swimlanes, metadata) — it deliberately duplicates the tiny `id`/`swimlane` shapes
  from the main schema rather than fighting cross-file `$ref` resolution for two
  defs that rarely change; real structural correctness is re-checked against
  `eventmodeling.schema.json` once joined, so this duplication is low-risk.
- `examples/order-fulfillment-split/` is a committed, permanent worked example of
  the layout (generated from `examples/order-fulfillment.json` via `npm run
  split`), not just an ephemeral test artifact.

**Deliberately not done**: a Nebulit-format import/export converter, built on this
same join/split seam. Scoped as a separate follow-on (M5), not core v2 — exporting
would need to duplicate elements per-slice per their model (lossy in guarantees,
not data), and importing needs a reconciliation pass for any inconsistent
duplicates found in a real Nebulit document.
example deliberately leaves those untagged to demonstrate that.
