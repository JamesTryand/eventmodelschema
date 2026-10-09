# eventmodelschema

A JSON Schema for [EventModeling](https://eventmodeling.org) documents — the
reference point bridging EventModeling design tooling and an implementation layer
that generates code/infrastructure from documents conforming to the schema.

## Contents

- `schema/eventmodeling.schema.json` — the schema itself (JSON Schema draft
  2020-12). See `schema/README.md` for how to validate a document against it, and
  what it deliberately does and doesn't enforce.
- `schema/examples/` — a minimal valid document and a worked example exercising
  every notation (all 3 slice patterns, all 3 scenario kinds, a hotspot, a chapter,
  an actor lane), plus `order-fulfillment-split/`, the same document laid out as a
  manifest + one file per registry/slice.
- `schema/manifest.schema.json` + `schema/scripts/{split,join,roundtrip-check}.js` —
  the multi-file composition layer: split a document into a manifest + files, join
  it back losslessly. See `schema/README.md`.
- `docs/design-notes.md` — design decisions and rationale for anyone extending the
  schema.
- `docs/methodology-notes.md` — EventModeling methodology reference (workshop
  steps, facilitation rules, the 20 Rules, anti-patterns) kept for context; doesn't
  map to schema fields directly.
- `resources/README.md` — points to the third-party reference document the schema
  was drafted from (Nebulit's "Event Modeling Cheat Sheet", not redistributed here)
  and to `docs/methodology-notes.md` for its extracted conceptual content.
- `CHANGELOG.md` — what changed at each `eventModelingSchemaVersion`.

## Status

`eventModelingSchemaVersion` `3.7.1`. `CHANGELOG.md` lists every change since 1.0.0; the
main additions are:

- **2.x:** typed fields; `translation` removed; `aggregate` tagging; a multi-file
  composition layer; the `sliceStatus` value `accepted`; derived read-model fields,
  stream-ending events and scoped queries; a grouped-rollup `groupBy` derivation;
  date-range filters (`readModel.filters`); command authorization (`requiredRole`,
  `fieldGatedRole`, `requiredOwnership`, `scope`) and `readModel.requiredRole`.
- **3.0.0** (the one breaking change): a required `field.piiSubject`, naming whose key a
  PII value is encrypted under.
- **3.1.0–3.1.1:** `match` filters for searchable fields, PII included, with normalizers
  pinned exactly.
- **3.2.0:** `readModel.selfAccess`, letting a caller read their own rows, and
  `dataSubjects.erasure`, saying who may erase a data subject.
- **3.3.0:** `outcomes`, saying which events a command emits together and which are
  alternatives.
- **3.4.0:** `ingresses`, letting a third party such as a payment processor call a command.
- **3.5.0:** timers and schedules, automations started by time.
- **3.6.0:** `effect`, an automation that calls the outside world.
- **3.7.0:** `partitioning`, putting every stream and read-model row in a partition (such
  as a tenant) by default.
- **3.7.1:** clarifications: an erasure declaration authorises a *request* for erasure,
  and a data subject belongs to one partition.

A companion lint tool remains future work. Validation here is structural only — see
`schema/README.md` for exactly what that means and what's deliberately left to a
separate lint/review layer.

## Related projects

This schema is the format two sibling projects build against:

- **eventmodeling-tooling** — produces documents conforming to this schema (a
  design-authoring GUI/CLI).
- **eventmodeling-codegen** — consumes documents conforming to this schema to
  generate code/infrastructure, using `dotnet-cqrs-baseline` as the reference base.

Both are early-stage; this schema doesn't depend on either being further along.
