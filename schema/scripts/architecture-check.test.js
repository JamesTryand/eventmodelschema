#!/usr/bin/env node
// The checker must be able to fail. The worked example (examples/architecture/) must pass; then each case
// below copies it, breaks one thing, and must be refused by the check it names, with its own message.
//
//   node scripts/architecture-check.test.js      (npm run test:architecture)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { check } = require('./architecture-check');

const EXAMPLE = path.join(__dirname, '..', 'examples', 'architecture');
const ARCH = 'library.architecture.json';
const MEMBERS = 'members.eventmodel.json';
const LENDING = 'lending.eventmodel.json';

const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const edge = (arch, id) => arch.edges.find((e) => e.id === id);
const field = (fields, name) => fields.find((f) => f.name === name);

// each case: a name, the check that must refuse it, a phrase its message must hold, and the break
const cases = [
  ['a carrier named on an edge (decision 0033)', 'structure', 'queue', (d) => {
    edge(d[ARCH], 'welcome-mail').queue = 'mail-out';
  }],
  ['an internal edge without targetId', 'structure', "must have required property 'targetId'", (d) => {
    delete edge(d[ARCH], 'member-becomes-borrower').targetId;
  }],
  ['an output edge with a command', 'structure', 'must NOT be valid', (d) => {
    edge(d[ARCH], 'welcome-mail').to = { system: 'lending', command: 'register-borrower' };
  }],
  ["a system's document missing", 'document', 'does not exist', (d) => {
    d[ARCH].systems.lending.document.path = 'nowhere.eventmodel.json';
  }],
  ["a system's document not valid", 'document', 'not a valid EventModel document', (d) => {
    d[LENDING].events['loan-overdue'].public = { version: 0 };
  }],
  ['an edge naming an unknown system', 'reference', 'not in this document', (d) => {
    edge(d[ARCH], 'join').to.system = 'catalogue';
  }],
  ['an edge naming an unknown event', 'reference', 'has no event "member-renamed"', (d) => {
    edge(d[ARCH], 'welcome-mail').from.event = 'member-renamed';
  }],
  ['a flow naming an unknown edge', 'reference', 'edge "renewal" is not in this document', (d) => {
    d[ARCH].flows[0].edges.push('renewal');
  }],
  ['an edge from a system to itself', 'reference', 'to itself', (d) => {
    const e = edge(d[ARCH], 'member-becomes-borrower');
    e.to = { system: 'members', command: 'join-member' };
  }],
  ['rule 3: a private event', 'public', 'is not public in "members"', (d) => {
    delete d[MEMBERS].events['member-joined'].public;
  }],
  ['rule 3: the wrong version', 'public', 'at version 1, not 2', (d) => {
    edge(d[ARCH], 'member-becomes-borrower').from.version = 2;
  }],
  ['rule 3: a private command', 'public', 'command "register-borrower" is not public', (d) => {
    delete d[LENDING].commands['register-borrower'].public;
  }],
  ["rule 3: a call's answer not public", 'public', 'command "record-reminder" is not public', (d) => {
    delete d[LENDING].commands['record-reminder'].public;
  }],
  ['rule 2: a target id not from the source event', 'target-id', '"borrowerId" is not a field of event', (d) => {
    edge(d[ARCH], 'member-becomes-borrower').targetId = 'borrowerId';
  }],
  ['rule 1: a field the command lacks', 'fields', 'command "register-borrower" has no field "shelf"', (d) => {
    edge(d[ARCH], 'member-becomes-borrower').fields.shelf = 'branchId';
  }],
  ['rule 1: a field the event lacks', 'fields', 'event "member-joined" has no field "homeBranch"', (d) => {
    edge(d[ARCH], 'member-becomes-borrower').fields.branchId = 'homeBranch';
  }],
  ['rule 1: types differ', 'fields', '"daysOverdue" is string but "days" is integer', (d) => {
    field(d[LENDING].events['loan-overdue'].fields, 'daysOverdue').type = 'string';
  }],
  ['rule 1: a required command field unmapped', 'fields', 'needs "branchId"', (d) => {
    delete edge(d[ARCH], 'member-becomes-borrower').fields.branchId;
  }],
  ['rule 4: personal data into a system without erasure', 'personal-data',
    'declares no governed erasure', (d) => {
      d[LENDING].commands['register-borrower'].fields.push(
        { name: 'email', type: 'string', pii: true, piiSubject: 'borrowerId' });
      edge(d[ARCH], 'member-becomes-borrower').fields.email = 'email';
    }],
  ['rule 4: personal data into a field not marked personal', 'personal-data', 'is not marked pii', (d) => {
    d[LENDING].dataSubjects = { erasure: { roles: ['librarian'] } };
    d[LENDING].commands['register-borrower'].fields.push({ name: 'email', type: 'string' });
    edge(d[ARCH], 'member-becomes-borrower').fields.email = 'email';
  }],
  ['rule 4: personal data into a placeholder', 'personal-data', 'is a placeholder', (d) => {
    d[LENDING].events['loan-overdue'].fields.push(
      { name: 'email', type: 'string', pii: true, piiSubject: 'borrowerId' });
    d[ARCH].systems.fines.placeholder.accepts[0].fields.push({ name: 'email', type: 'string', pii: true,
      piiSubject: 'borrowerId' });
    edge(d[ARCH], 'overdue-fine').fields.email = 'email';
  }],
  ['a flow whose edges do not connect', 'flow', 'starts in "lending"', (d) => {
    d[ARCH].flows[0].edges = ['join', 'overdue-fine'];
  }],
  ['a flow continuing after an output', 'flow', 'is an output', (d) => {
    d[ARCH].flows[1].edges = ['join', 'welcome-mail', 'member-becomes-borrower'];
  }],
];

function run(name, mutate) {
  const docs = { [ARCH]: read(EXAMPLE, ARCH), [MEMBERS]: read(EXAMPLE, MEMBERS), [LENDING]: read(EXAMPLE, LENDING) };
  if (mutate) mutate(docs);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-check-'));
  try {
    for (const [f, doc] of Object.entries(docs)) fs.writeFileSync(path.join(dir, f), JSON.stringify(doc, null, 2));
    return check(path.join(dir, ARCH)).problems;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let failed = 0;
const base = run('the worked example', null);
if (base.length) {
  failed++;
  console.log('FAIL the worked example is refused:');
  for (const p of base) console.log(`     [${p.rule}] ${p.at}: ${p.message}`);
} else {
  console.log('ok   the worked example passes');
}
for (const [name, rule, phrase, mutate] of cases) {
  const problems = run(name, mutate);
  const hit = problems.find((p) => p.rule === rule && p.message.includes(phrase));
  if (hit) {
    console.log(`ok   ${name}: [${rule}] ${hit.message}`);
  } else {
    failed++;
    console.log(`FAIL ${name}: wanted [${rule}] "${phrase}", got:`);
    for (const p of problems) console.log(`     [${p.rule}] ${p.at}: ${p.message}`);
    if (!problems.length) console.log('     nothing refused');
  }
}
console.log(`\n${cases.length + 1 - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
