# eventmodeling.schema.json

JSON Schema (draft 2020-12) for documents describing an [EventModeling](https://eventmodeling.org)
model: swimlanes, the 5 elements (Event / Command / Read Model / Screen / Automation),
the 4 slice patterns (State Change / State View / Automation / Translation), scenarios,
and the optional notation layer (hotspots, chapters, actor lanes, slice status).

## Validating

```sh
npm install
npm run validate   # validates schema/examples/*.json against the schema
```

Uses [ajv-cli](https://github.com/ajv-validator/ajv-cli) with `--spec=draft2020` and
`ajv-formats` (for the `"$schema"` property's `uri` format). To validate a document of
your own:

```sh
npx ajv validate -s eventmodeling.schema.json -d path/to/your-document.json --spec=draft2020 -c ajv-formats
```

## What this schema does and does not check

**Structural validity only.** A document that passes this schema is well-formed —
every slice has the fields its declared `pattern` requires, every scenario's `kind`
matches what its slice's pattern allows, ids look like ids. It is **not** a check that
the model is *finished* or *methodologically sound*. In particular, this schema
deliberately does **not** enforce:

- That a `Command.reason` or `ReadModel.question` is filled in (both fields are
  optional here) — see `docs/design-notes.md` for why.
- Any of the "20 Rules" (e.g. "every command has a reason," "no question, no read
  model") beyond what's listed above.
- The 4 anti-patterns (one Command/one Read Model fanning to many Events, one Screen
  driving many Commands, a slice with no scenarios while its siblings have some) —
  these are about *cardinality*, which this schema leaves deliberately unconstrained
  (no `maxItems`) so the anti-patterns stay observable rather than becoming
  unrepresentable.
- Referential integrity — that an id referenced by `swimlaneId`, `eventIds`,
  `readModelId`, etc. actually exists in the corresponding registry. JSON Schema has
  no cross-property lookup keyword; this needs a small companion linter.

These are all intentionally left to a **separate lint/review layer**, run at a later
gate (e.g. merge or publish) rather than at parse time — see `docs/design-notes.md`.

## Versioning

`eventModelingSchemaVersion` in each document is a semver string (`"1.0.0"` for this
draft). Bump it when the schema's shape changes in a way that could invalidate
existing documents.

## Known gaps / deliberately deferred

- No typed payload schemas for individual events/commands/read-model results — the
  `data` / `queryParams` / `result` fields in scenarios are free-form objects.
- No file-splitting (`$ref` across files) — everything lives in one file for now.
- The `$id` (`https://raw.githubusercontent.com/jamestryand/eventmodelschema/main/schema/eventmodeling.schema.json`)
  points at this repo's raw content on the `main` branch. Note `$id` is an
  identifier, not a resolvability guarantee — it doesn't need to be fetchable to be
  valid — but this one happens to be, since it's a real public repo.
- The cheat sheet's "show one screen after another" UI-only walkthrough notation is
  excluded — it has no events/commands/read-models, so it's out of scope for a
  *document* schema (see `docs/design-notes.md`).
