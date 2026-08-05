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

## Status

v2 in progress: typed fields, an `aggregate` type-level tag on Event/Command, and a
multi-file composition layer have landed since v1; a companion lint tool remains
future work. Structural validation only — see `schema/README.md` for exactly what
that means and what's deliberately left to a separate lint/review layer.

## Related projects

This schema is the format two sibling projects build against:

- **eventmodeling-tooling** — produces documents conforming to this schema (a
  design-authoring GUI/CLI).
- **eventmodeling-codegen** — consumes documents conforming to this schema to
  generate code/infrastructure, using `dotnet-cqrs-baseline` as the reference base.

Both are early-stage; this schema doesn't depend on either being further along.
