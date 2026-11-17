#!/usr/bin/env node
// Checks a coordinating document (architecture.schema.json) and the EventModel documents it names.
//
//   node scripts/architecture-check.js <coordinating-document.json> [--json]
//
// Exit 0 when nothing is refused, 1 when something is, 2 on a usage error. Each problem names the check it
// failed (in brackets) and where. Then a coupling report: per system, the edges into and out of it, and the
// systems it depends on.
//
// The checks (docs/design-notes.md, "Coordinating documents"):
//   structure      the coordinating document against architecture.schema.json
//   document       (1) each system's EventModel document exists and is valid against eventmodeling.schema.json
//   reference      every system, edge and flow id an edge or flow names exists, once
//   public         (2, rule 3) an edge uses only events and commands its system marks public, at that version
//   target-id      (3, rule 2) an internal edge's targetId names fields of the source event
//   fields         (4, rule 1) every mapped field exists on both sides with the same type, and every required
//                  field of the receiving command is mapped
//   personal-data  (5, rule 4) a personal field crosses only into a system that declares governed erasure,
//                  and into a field marked personal there too
//   flow           (7) each flow's edges connect in order
//
// Not yet (step 2): a document replacing a placeholder honours its contract (6). Split documents (a manifest)
// are not read yet: a system's document is one file.
'use strict';

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats').default;

const SCHEMA_DIR = path.join(__dirname, '..');

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validator(schemaFile) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(loadJson(path.join(SCHEMA_DIR, schemaFile)));
}

let validateArchitecture;
let validateEventModel;

function ajvMessages(errors) {
  return (errors || []).map((e) => `${e.instancePath || '/'} ${e.message}` +
    (e.params && e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ''));
}

// A system's contract: its events and commands, each with fields and its public marker, and whether it
// declares governed erasure.
function documentContract(doc) {
  const events = {};
  for (const [id, ev] of Object.entries(doc.events || {})) {
    events[id] = { fields: ev.fields, public: ev.public };
  }
  const commands = {};
  for (const [id, cmd] of Object.entries(doc.commands || {})) {
    commands[id] = { fields: cmd.fields, public: cmd.public };
  }
  return { events, commands, erasure: !!(doc.dataSubjects && doc.dataSubjects.erasure), placeholder: false };
}

function placeholderContract(ph) {
  const events = {};
  for (const ev of ph.publishes || []) {
    events[ev.event] = { fields: ev.fields || [], public: { version: ev.version } };
  }
  const commands = {};
  for (const cmd of ph.accepts || []) {
    commands[cmd.command] = { fields: cmd.fields || [], public: { version: cmd.version || 1 } };
  }
  return { events, commands, erasure: false, placeholder: true };
}

function fieldNamed(fields, name) {
  return (fields || []).find((f) => f.name === name);
}

function check(file) {
  validateArchitecture = validateArchitecture || validator('architecture.schema.json');
  validateEventModel = validateEventModel || validator('eventmodeling.schema.json');
  const problems = [];
  const refuse = (rule, at, message) => problems.push({ rule, at, message });

  let arch;
  try {
    arch = loadJson(file);
  } catch (err) {
    refuse('structure', file, `cannot be read as JSON: ${err.message}`);
    return { problems, coupling: {} };
  }
  if (!validateArchitecture(arch)) {
    for (const m of ajvMessages(validateArchitecture.errors)) refuse('structure', file, m);
    return { problems, coupling: {} };
  }

  // (1) each system's document, or its placeholder
  const base = path.dirname(file);
  const systems = {};
  for (const [sid, sys] of Object.entries(arch.systems)) {
    if (sys.placeholder) {
      systems[sid] = placeholderContract(sys.placeholder);
      continue;
    }
    const docPath = path.resolve(base, sys.document.path);
    const at = `systems.${sid}`;
    if (!fs.existsSync(docPath) || !fs.statSync(docPath).isFile()) {
      refuse('document', at, `its document ${sys.document.path} does not exist`);
      continue;
    }
    let doc;
    try {
      doc = loadJson(docPath);
    } catch (err) {
      refuse('document', at, `its document ${sys.document.path} cannot be read as JSON: ${err.message}`);
      continue;
    }
    if (!validateEventModel(doc)) {
      for (const m of ajvMessages(validateEventModel.errors)) {
        refuse('document', at, `its document ${sys.document.path} is not a valid EventModel document: ${m}`);
      }
      continue;
    }
    systems[sid] = documentContract(doc);
  }

  const edges = arch.edges || [];
  const edgeById = {};
  for (const [i, edge] of edges.entries()) {
    if (edgeById[edge.id]) refuse('reference', `edges[${i}]`, `edge id "${edge.id}" is used twice`);
    edgeById[edge.id] = edge;
  }

  // the event at an edge's start; null when it cannot be resolved (and the reason has been reported)
  function sourceEvent(edge) {
    const at = `edges.${edge.id}.from`;
    const { system, event, version } = edge.from;
    if (!(system in arch.systems)) {
      refuse('reference', at, `system "${system}" is not in this document`);
      return null;
    }
    const contract = systems[system];
    if (!contract) return null; // its document failed (1)
    const ev = contract.events[event];
    if (!ev) {
      refuse('reference', at, `system "${system}" has no event "${event}"`);
      return null;
    }
    if (!ev.public) {
      refuse('public', at, `event "${event}" is not public in "${system}": mark it public (with a version) ` +
        'in its document before another system uses it');
      return null;
    }
    if (ev.public.version !== version) {
      refuse('public', at, `event "${event}" is public in "${system}" at version ${ev.public.version}, ` +
        `not ${version}`);
      return null;
    }
    return ev;
  }

  function targetCommand(end, at) {
    const { system, command } = end;
    if (!(system in arch.systems)) {
      refuse('reference', at, `system "${system}" is not in this document`);
      return null;
    }
    const contract = systems[system];
    if (!contract) return null;
    const cmd = contract.commands[command];
    if (!cmd) {
      refuse('reference', at, `system "${system}" has no command "${command}"`);
      return null;
    }
    if (!cmd.public) {
      refuse('public', at, `command "${command}" is not public in "${system}": mark it public (with a ` +
        'version) in its document before another system sends it');
      return null;
    }
    return cmd;
  }

  for (const edge of edges) {
    const ev = edge.from ? sourceEvent(edge) : null;
    const cmd = edge.to ? targetCommand(edge.to, `edges.${edge.id}.to`) : null;
    for (const [i, answer] of (edge.answers || []).entries()) {
      targetCommand(answer, `edges.${edge.id}.answers[${i}]`);
    }
    if (edge.kind !== 'internal') continue;
    const at = `edges.${edge.id}`;
    if (edge.from.system === edge.to.system) {
      refuse('reference', at, `an edge from "${edge.from.system}" to itself: that is the system's own ` +
        'automation, and belongs in its document');
      continue;
    }
    if (!ev || !cmd) continue;
    if (!Array.isArray(ev.fields)) {
      refuse('fields', at, `event "${edge.from.event}" declares no fields, so the edge cannot be checked`);
      continue;
    }
    if (!Array.isArray(cmd.fields)) {
      refuse('fields', at, `command "${edge.to.command}" declares no fields, so the edge cannot be checked`);
      continue;
    }

    // (3, rule 2) target ids from the source event
    const targets = Array.isArray(edge.targetId) ? edge.targetId : [edge.targetId];
    for (const t of targets) {
      if (!fieldNamed(ev.fields, t)) {
        refuse('target-id', `${at}.targetId`, `"${t}" is not a field of event "${edge.from.event}": the ` +
          "command's target id must come from the source event, so a redelivery reaches the same target");
      }
    }

    // (4, rule 1) the receiver's translation
    const receiver = systems[edge.to.system];
    for (const [cmdField, evField] of Object.entries(edge.fields)) {
      const into = fieldNamed(cmd.fields, cmdField);
      const from = fieldNamed(ev.fields, evField);
      const fat = `${at}.fields.${cmdField}`;
      if (!into) refuse('fields', fat, `command "${edge.to.command}" has no field "${cmdField}"`);
      if (!from) refuse('fields', fat, `event "${edge.from.event}" has no field "${evField}"`);
      if (!into || !from) continue;
      if (into.type !== from.type) {
        refuse('fields', fat, `"${evField}" is ${from.type} but "${cmdField}" is ${into.type}`);
      }
      if ((into.cardinality || 'single') !== (from.cardinality || 'single')) {
        refuse('fields', fat, `"${evField}" is ${from.cardinality || 'single'} but "${cmdField}" is ` +
          `${into.cardinality || 'single'}`);
      }
      // (5, rule 4) personal data
      if (from.pii) {
        if (!receiver.erasure) {
          refuse('personal-data', fat, `"${evField}" is personal data, and "${edge.to.system}" ` +
            (receiver.placeholder
              ? 'is a placeholder, which cannot declare erasure: write its document first'
              : 'declares no governed erasure (dataSubjects.erasure)'));
        }
        if (!into.pii) {
          refuse('personal-data', fat, `"${evField}" is personal data, but "${cmdField}" is not marked pii, ` +
            'so the receiver would keep it where erasure cannot reach');
        }
      }
    }
    for (const f of cmd.fields) {
      if (!f.optional && !(f.name in edge.fields)) {
        refuse('fields', `${at}.fields`, `command "${edge.to.command}" needs "${f.name}", which the edge ` +
          'does not map');
      }
    }
  }

  // (7) flows connect in order
  const flowIds = new Set();
  for (const [i, flow] of (arch.flows || []).entries()) {
    const at = `flows.${flow.id}`;
    if (flowIds.has(flow.id)) refuse('reference', `flows[${i}]`, `flow id "${flow.id}" is used twice`);
    flowIds.add(flow.id);
    const steps = flow.edges.map((id) => {
      if (!edgeById[id]) refuse('reference', at, `edge "${id}" is not in this document`);
      return edgeById[id];
    });
    if (steps.some((s) => !s)) continue;
    for (let k = 1; k < steps.length; k++) {
      const prev = steps[k - 1];
      const next = steps[k];
      const ends = prev.to ? [prev.to.system] : (prev.answers || []).map((a) => a.system);
      if (!ends.length) {
        refuse('flow', at, `"${prev.id}" is an output: nothing comes back, so no edge can follow it`);
        continue;
      }
      if (!next.from) {
        refuse('flow', at, `"${next.id}" is an input from outside, so it cannot follow "${prev.id}"`);
        continue;
      }
      if (!ends.includes(next.from.system)) {
        refuse('flow', at, `"${next.id}" starts in "${next.from.system}", but "${prev.id}" ends in ` +
          `"${ends.join('", "')}"`);
      }
    }
  }

  return { problems, coupling: coupling(arch) };
}

// (8) per system: edges in (afferent) and out (efferent), and the systems it depends on (whose public
// events it receives) and that depend on it
function coupling(arch) {
  const report = {};
  for (const sid of Object.keys(arch.systems)) {
    report[sid] = { in: [], out: [], dependsOn: [], usedBy: [] };
  }
  const add = (list, item) => { if (!list.includes(item)) list.push(item); };
  for (const edge of arch.edges || []) {
    if (edge.from && report[edge.from.system]) add(report[edge.from.system].out, edge.id);
    if (edge.to && report[edge.to.system]) add(report[edge.to.system].in, edge.id);
    for (const a of edge.answers || []) if (report[a.system]) add(report[a.system].in, edge.id);
    if (edge.kind === 'internal' && report[edge.from.system] && report[edge.to.system]) {
      add(report[edge.to.system].dependsOn, edge.from.system);
      add(report[edge.from.system].usedBy, edge.to.system);
    }
  }
  return report;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--json');
  if (args.length !== 1) {
    process.stderr.write('usage: node scripts/architecture-check.js <coordinating-document.json> [--json]\n');
    return 2;
  }
  const result = check(args[0]);
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    for (const p of result.problems) process.stdout.write(`REFUSED [${p.rule}] ${p.at}: ${p.message}\n`);
    if (!result.problems.length) process.stdout.write(`ok: ${args[0]}\n`);
    process.stdout.write('\ncoupling (in = edges into it, out = edges out of it):\n');
    for (const [sid, c] of Object.entries(result.coupling)) {
      process.stdout.write(`  ${sid}: in ${c.in.length}, out ${c.out.length}` +
        (c.dependsOn.length ? `; depends on ${c.dependsOn.join(', ')}` : '') +
        (c.usedBy.length ? `; used by ${c.usedBy.join(', ')}` : '') + '\n');
    }
  }
  return result.problems.length ? 1 : 0;
}

module.exports = { check };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
