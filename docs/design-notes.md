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

The value set is a design-session board vocabulary, not part of the structural
contract a code generator reads — but it is a closed `enum`, so a value outside it
is a hard validation failure, and because `status` is defined on `sliceBase`
(referenced from `slice`'s `allOf`), that failure drops `sliceBase`'s evaluated
properties and the sibling `unevaluatedProperties: false` on `slice` then reports
`id`/`name`/`swimlaneId`/`chapterId`/`businessCapability`/`status` as unevaluated —
a cascade that looks like a defect in the `allOf` + `if`/`then` shape but is only
ever an out-of-enum `status` (or any other `sliceBase` keyword failing). `2.1.0`
added `"accepted"` after real authoring hit exactly this: a `planned → accepted`
sign-off step with no enum value to land on. When extending the set, prefer adding
a value over leaving authors to overload an ill-fitting one.

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

## v2.2.0: derived read-model fields, stream-ending events, scoped queries

Came from real codegen use (`platform/codegen-handwrite-gaps`, working the
timesheets model through `dotnetcqrs`/`pocketcqrs`), not from re-reading the
methodology cold. A generic single-event field-merge — copy whichever payload keys
share a name with a read-model column, fold every event as "this stream now
exists" — covers most of a real model but breaks on three shapes that recur
often enough to be worth naming rather than hand-writing every time:

- **A boolean that toggles between two named events** (e.g. an SSO-enabled flag
  set by one event, cleared by another) — the generic copy never fires, because
  neither event's payload literally carries that field.
- **A per-row count/sum rolled up from a *different* stream** (e.g. how many
  staff are currently assigned to a project — the assignment events live on the
  assignment stream, not the project's) — a single-stream field-merge has no
  `GROUP BY` concept at all.
- **A stream that can be "created" more than once across its lifetime** (assign,
  unassign, re-assign) — the generic fold only ever sets a stream's existence to
  true; nothing ever tells it an event should retract that. This is the same root
  cause as the two above (fold-only-sets), just showing up in the write-side
  decider's existence guard rather than a read-side projection.
- **A query scoped through a relationship the read model doesn't itself carry**
  (a Project Manager's view of flagged entries, scoped to the projects they
  manage — a fact that lives in a *different* read model). Not a fold problem,
  but the same underlying gap: nothing in the document states the relationship a
  correct query needs.

**Why schema-level and not "just hand-write it every time":** the whole point of
generating code from a document is that a *class* of recurring shape gets solved
once, in the generator, driven by a declaration — the same reasoning that already
motivated `field`'s typed shape in v2. Leaving these four as permanent hand-write
gaps means re-solving the same problem in every generated backend, which is
exactly the kind of drift risk regeneration is supposed to eliminate.

**Deliberately explicit, not inferred.** An earlier candidate for the third case
was inferring "this event ends the stream" from a scenario proving a create
succeeds after some prior history on the same stream. Rejected: this schema's own
rule from the start ("no attempt to verify that ids resolve... deriving one from
the swimlane would silently merge unrelated stream families") already argues
against silently deriving structural facts from data shape, and a document
author may not have written the very scenario the inference needs yet — the
declaration should not depend on how thoroughly the model happens to be tested.

**Concretely:**
- `field` gains an optional `derivation` (`$def` `fieldDerivation`), a `kind`-discriminated
  shape mirroring `scenario`/`slice`'s existing `if`/`then` pattern: `toggle`
  (`onEventIds`/`offEventIds`/`initial`), `count`
  (`incrementOnEventIds`/`decrementOnEventIds`/`rowKeyField`), `sum`
  (`addOnEventIds`/`subtractOnEventIds`/`amountField`/`rowKeyField`). `rowKeyField`
  names the payload field on the counted/summed events that identifies the target
  row when the events aren't on the read model's own stream; a generator may
  default it to the read model's own key-field name when omitted.
- `event` gains an optional `endsStream` (boolean) — the write-side analogue of a
  read-model `toggle`'s "off" event, for the one piece of state every generator
  already synthesizes itself (a stream's existence) rather than a value declared
  anywhere in the document.
- `readModel` gains an optional `scopes` (array of `$def` `readModelScope`):
  `{ param, via: { readModelId, matchParamTo, selectField, filterLocalField } }`,
  declaring that a query param resolves to a filtering set via a different read
  model, rather than naming one of this read model's own columns. Placed on the
  read model rather than the querying slice — the scoping *capability* is a
  property of the data, and one declaration then serves every slice that queries
  it (a scope-free query just never supplies the param).
- All three are optional and additive; a 2.1.0 document validates unchanged
  against 2.2.0. As with `builtFromEventIds` today, this schema does not verify
  that an `onEventIds`/`via.readModelId` reference actually resolves to a real
  element — that stays the future methodology-lint's job (see "Structural
  validation vs. methodology validation," above), not a JSON Schema concern
  (no cross-property lookup keyword exists for it anyway).
- Deliberately NOT added: a formal aggregate-state object. `endsStream` is the
  one flag needed to make the synthesized `Exists` correct across a full
  create/end/re-create lifecycle; a general aggregate-state schema is a bigger
  change with no second use case yet.

## v2.3.0: grouped-rollup derivation (`groupBy`)

Came from the same real-model pressure as v2.2.0 (`platform/eventmodeling-verify-gaps`,
working `project/timesheets`'s `payroll-periods` read model through `dotnetcqrs`/
`pocketcqrs`): `field.derivation`'s three v2.2.0 kinds (`toggle`/`count`/`sum`) only ever
produce a single scalar value per read-model row. `payroll-periods.staffTotals` needs a
genuinely different shape — a *list* of `{staffId, outOfHoursHours, payrollAmount}` rows
nested inside each payroll-period row, one row per distinct staff member who logged
out-of-hours time in that period. This is the second time a grouped-rollup shape has
come up (the first, `count`/`sum`'s own `rowKeyField`, only covers "many independent
top-level read-model rows keyed by X," not "one nested list inside a single row").

**Design question this needed to resolve first** (flagged open since 2026-09-02,
`NEEDS.md`): does the nested list-of-objects shape need a new `Field`-level concept, or
does a single generalized `derivation.kind` value suffice? Resolved as the latter, for
one reason: `field` already has everything the *shape* needs — `cardinality: "list"` +
recursive `subfields` (added in v2, for typed nested objects generally) already
describes "a field whose value is a list of `{staffId, outOfHoursHours, payrollAmount}`
records." What was missing was only the *derivation* — how those rows and their values
get computed — not the shape itself. So `groupBy` is a `fieldDerivation` kind like the
other three, requiring only one new property (`groupByField`, the payload field whose
distinct values become the list's rows), and each **subfield** carries its own ordinary
`derivation` (`sum`/`count`/`toggle`, recursively — `field.subfields` items are already
full `field` objects) computed *within* that subfield's group rather than across the
whole read model. No new recursion or `$def` was needed for this — `field`'s existing
recursive shape already gives it for free. The field named by `groupByField` itself
needs no `derivation` — its value is just the grouping key's own value, copied straight
from the matching event payload, the same way an un-derived field already copies a
same-named payload key today.

**Enforced structurally, unlike id-reference fields:** `field` gains a same-object
`allOf`/`if`/`then` (mirroring `scenario`/`slice`'s existing pattern) requiring
`cardinality: "list"` and a non-empty `subfields` whenever `derivation.kind` is
`groupBy` — this is a same-object property relationship (not a cross-document id
reference like `onEventIds`/`via.readModelId`), so unlike those, it's cheap and
worthwhile to enforce at the JSON Schema level rather than deferring to the future
methodology-lint. Still NOT enforced (same reasoning as every other `*EventIds`/
`*Field` reference in this schema): that `groupByField` actually names one of the
declared `subfields`, or that a nested subfield's own `addOnEventIds`/etc. actually
resolve to real events — those stay structural-validity gaps by design, same as
`onEventIds` always has been.

**Deliberately narrow scope — what this does NOT solve.** `payroll-periods.staffTotals`
in the real model also needs each contributing event correlated to the specific
payroll-period row it belongs to (`time-entry-logged`'s `taskDate` falling within that
row's own `periodStart`/`periodEnd`) and filtered to only entries where
`outOfHoursHours` is non-zero. Both are deliberately **out of scope here** — the former
is the still-undecided `dateRange` capability (`platform/eventmodeling-verify-gaps`
Group C item 3, the bigger of that issue's two open design questions), and folding it
into `groupBy` now would have pre-committed part of that separate decision. A document
using `groupBy` alone gets the grouping/fold mechanism generated; row-scoping by date
range and value-filtering the contributing events still need either a small hand-written
wrapper or the future `dateRange` capability landing on top. Chosen deliberately (over
bundling both in one change) to keep this addition shippable and independently useful
for grouped-rollup shapes that don't need date scoping at all.

**Concretely:**
- `fieldDerivationKind` gains `"groupBy"`. Its `fieldDerivation` branch requires one
  property: `groupByField` (string) — the source event payload field whose distinct
  values become one row each in the parent field's list.
- `field` gains a cross-property `allOf`/`if`/`then`: `derivation.kind: "groupBy"`
  requires `cardinality: "list"` and non-empty `subfields`.
- No changes to `event`, `command`, `readModel`, or any other `$def`.
- Additive; a 2.2.0 document validates unchanged against 2.3.0. Verified: `npm run
  validate`/`roundtrip`/`validate:manifest` all green unchanged; a smoketest document
  modeling `payroll-periods.staffTotals` with `groupBy` + nested `sum` subfields
  validates; two malformed variants (missing `groupByField`; `groupBy` on a field
  missing `cardinality`/`subfields`) are each rejected with a single clean error.

## v2.4.0: `readModel.filters` — single-field date-range query filtering

The other half of the same `dateRange` gap `groupBy` (2.3.0) deliberately left out:
`export-pm-slice`'s real scenario (`platform/eventmodeling-verify-gaps` Group C item 3,
`project/timesheets`'s `time-entries` read model) needs its `taskDate` field range-tested
against `last7Days`/`lastCalendarMonth`/a `custom` `from`/`to` pair — and at least two
sibling export/report scenarios in the same model (`export-manager-slice`,
`export-staff-slice`) need the identical shape. Grounded directly against the
`dotnetcqrs` codebase (`platform/eventmodeling-verify-gaps`, this session) before
designing, not assumed: `readModel.scopes` (2.2.0) has no production consumer today —
only the verify harness's `SelectRowsAsync` reads it, to *simulate* what a real query
gateway would do (`HarnessProgram.txt:206`'s own comment says so) — and that same harness
currently skips any object-shaped `queryParams` value outright
(`HarnessProgram.txt:190-195`), which is exactly the shape a `dateRange` param takes, so
`export-pm-slice` fails today on unfiltered rows, not close-but-wrong filtering.

**Deliberately narrow, same move as `groupBy`.** A single-field WHERE-range filter with
named presets only — explicitly NOT `staffTotals`-style cross-row/cross-stream
correlation (`taskDate` falling inside a *different row's* `periodStart`/`periodEnd`).
Stage 3a of the `groupBy` execution plan already proved that shape doesn't generalize
under a schema-level derivation and had to be hand-written
(`Payroll/PayrollPeriodsQuery.cs`) — `export-pm-slice`'s actual need is a plain
single-field range filter against one of the read model's own columns, a much smaller
and more clearly reusable capability than the original "comparable to `groupBy`"
estimate assumed.

**Design question this needed to resolve: presets closed or extensible?** Resolved as a
closed `enum` (`$def` `dateRangePreset`: `last7Days`/`lastCalendarMonth`/`custom`), same
precedent as `sliceStatus`/`fieldDerivationKind` elsewhere in this schema — every named
preset is date math a generator must actually implement, so an open-ended string here
would let a document declare a preset no generator could ever honor. Extending the set
later is a minor, additive version bump (exactly how `sliceStatus` gained `"accepted"`
in 2.1.0 and `fieldDerivationKind` gained `"groupBy"` in 2.3.0), not a design change.

**Runtime value shape is a documented convention, not a schema constraint** — consistent
with this schema's existing boundary (`data`/`queryParams`/`result` in scenarios stay
untyped `object`, see "Structural validation vs. methodology validation," above).
Confirmed directly against `project/timesheets`'s real model (`export-manager-slice`,
`export-pm-slice`, `export-staff-slice` scenarios), which already uses this exact shape
predating this schema change: a `queryParams` value for a `dateRange`-filtered param is
`{ "kind": "<preset>" }` for a named preset, or `{ "kind": "custom", "from": "<ISO
date>", "to": "<ISO date>" }` for the custom bound — `from`/`to` are fixed property
names, not configurable per-filter, since there is exactly one bounded-range shape to
express. `kind` (not e.g. `preset`) as the discriminator property name inside that value
was chosen to match the schema's own established discriminator-naming convention
(`scenario.kind`, `fieldDerivation.kind`) — and it was already the name the real model's
author had independently picked before this schema change existed, which is taken as
confirmation the convention reads naturally to someone authoring a document by hand, not
just to the schema's own internal consistency.

**Concretely:**
- `filterKind` (new `$def`, currently one value: `"dateRange"`) and `dateRangePreset`
  (new `$def`: `last7Days`/`lastCalendarMonth`/`custom`).
- `readModelFilter` (new `$def`): `{ param, field, kind }` always required, plus a
  `kind`-discriminated `allOf`/`if`/`then` (mirroring `fieldDerivation`/`scenario`/
  `slice`'s existing pattern) requiring `presets` (non-empty, unique, `dateRangePreset`
  values) whenever `kind` is `"dateRange"` — the only kind today, but shaped so a future
  second `kind` (e.g. a numeric range) doesn't need restructuring. `param` names the
  query param (mirrors `readModelScope.param`); `field` names the local read-model
  column being range-tested (mirrors `readModelScope.via.filterLocalField`, but no `via`
  indirection is needed here since the target field is always this read model's own).
- `readModel` gains an optional `filters` (array of `readModelFilter`), sibling to
  `scopes`.
- No changes to `event`, `command`, `scenario`, or any other `$def` — `queryParams` stays
  an untyped `object`, per the convention above.
- Additive; a 2.3.0 document validates unchanged against 2.4.0. Verified: `npm run
  validate`/`roundtrip`/`validate:manifest` all green unchanged; a smoketest document
  modeling `export-pm-slice`'s real dateRange need (`last7Days` and `custom` scenarios
  against `time-entries.taskDate`, alongside its existing `pmStaffId` scope) validates;
  two malformed variants (a `dateRange` filter missing `presets`; a `presets` entry
  outside the closed enum) are each rejected with a single clean error.

## v2.5.0: command authorization

Came from `platform/command-authorization` (`project/timesheets`'s Phase 04g auth
work): every command in that model was either ungated or hand-gated by an ad-hoc
check written directly in a literal host route (`StaffOnboardingHost.cs`,
`TimeEntryFlaggingHost.cs`, `ImpersonationHost.cs`) — the same class of recurring
hand-write this schema has repeatedly chosen to invest in generating instead
(`endsStream`/`derivation`/`scopes`/`groupBy`/`filters` all followed this same
path). The real model surfaced four distinct shapes, not one: a plain role
requirement; a role requirement conditional on a payload field's value; an
ownership requirement (actor must own the target row); and a role-bypass-else-
scoped-membership requirement. All four are additive, all four are grounded in
real commands and, notably, in real *already-hand-written* code this addition
replaces rather than merely supplements.

**Why `requiredOwnership` needed a `via` lookup, not a bare field name.**
An early sketch used a bare `targetField`. Checked against the real dispatch
architecture before finalizing: authorization has to be decided *before* a
command's decider runs (no earlier hook exists to inspect current aggregate
state), off a read model, the same way `TimeEntryFlaggingHost.AuthorizeAsync`
already does its own project-membership check by hand today. So `via` reuses
`readModelScope`'s vocabulary (`readModelId`, plus `keyField`/`ownerField`
naming the lookup and the compared field) rather than inventing new names for
the same idea.

**Why `requiredOwnership` and `scope` stayed two declarations instead of one.**
They share a first step (resolve a value from the target's own read-model row)
but diverge on the second: `requiredOwnership` compares that value to the
actor's own id directly (equality); `scope` checks the actor's own id is a
*member of a set* resolved through a second read model (membership) — the same
semi-join shape `readModelScope` already uses for query-time filtering, just
triggered at authorization time instead. A single declaration covering both
would need an optional second stage whose mere presence or absence silently
switches the check's meaning — exactly the kind of implicit derivation this
schema has consistently rejected elsewhere (see `endsStream`, deliberately
explicit rather than inferred from scenario shape). Two named declarations,
sharing a generator-side evaluator for the bypass-then-resolve order, keep the
meaning of each visible from its own name.

**Why `fieldGatedRole` got a real shape instead of staying a hand-write
exception.** The model has two commands needing it (`onboard-staff`,
`change-staff-role`), not one, with an identical `{field, value, requiredRole}`
shape — clearing the same "recurs, don't hand-write it a second time" bar
`groupBy`/`filters` each used before being built.

**What this addition does NOT need to solve: where a role claim like
"administrator" actually comes from.** `requiredRole` is a plain
`commandRole` (kebab-case id, or an array of them) — not an enum closed over
any particular aggregate's role field, the same "doesn't verify a reference
resolves" boundary every `*EventIds`/`via.readModelId` field in this schema
already has. A role value sourced from outside any `staff`-shaped aggregate
entirely (`platform/command-authorization`'s own "Administrator" decision —
a separate concept, not a `staff.role` value) is exactly as well-formed under
`requiredRole` as one sourced from it. This schema is deliberately indifferent
to how an actor's role claim gets populated at runtime — that's a host-layer/
authentication-enrichment concern, same "auth is deliberately not built into
this library" split `dotnetcqrs`'s `CqrsGatewayEndpoints` already states for
authentication itself, now extended to authorization.

**Concretely:**
- `command` gains four optional properties: `requiredRole` (new `$def`
  `commandRole`), `fieldGatedRole` (new `$def` `commandFieldGatedRole`),
  `requiredOwnership` (new `$def` `commandOwnership`), `scope` (new `$def`
  `commandScope`) — see `CHANGELOG.md`'s 2.5.0 entry for each `$def`'s full
  shape.
- No changes to `event`, `readModel`, `scenario`, or any other `$def`.
- Additive; a 2.4.0 document validates unchanged against 2.5.0. Verified:
  `npm run validate`/`roundtrip`/`validate:manifest` all green unchanged; a
  smoketest document exercising all four new keywords (`requiredRole` in both
  single-value and array form, `fieldGatedRole`, `requiredOwnership`, and
  `scope` with a `bypassRoles` entry) validates; three malformed variants
  (`requiredOwnership` missing `via`; `scope` missing `memberOfVia`;
  `fieldGatedRole` missing `requiredRole`) are each rejected with a single
  clean error.
- One implementation-level refinement beyond the design proposal's literal
  text: `commandFieldGatedRole.value` uses `oneOf` over `string`/`boolean`/
  `number` rather than a `type` array — ajv's strict mode flags bare
  `"type": [...]` union arrays (`strictTypes`), and this schema had no prior
  precedent for that form anyway; `oneOf` is the idiom already used elsewhere
  here (`hotspotTarget`, `commandRole`).
