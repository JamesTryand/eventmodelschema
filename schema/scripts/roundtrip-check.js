#!/usr/bin/env node
// Proves split.js/join.js are true inverses: split a known-good document,
// join it back, and deep-compare (order-independent for objects, but array
// order -- slices, swimlanes -- must still match) against the original.
//
// Usage: node scripts/roundtrip-check.js <input.json>

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { execFileSync } = require("child_process");

function main() {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error("Usage: node scripts/roundtrip-check.js <input.json>");
    process.exit(1);
  }

  const scriptsDir = __dirname;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eventmodel-roundtrip-"));
  const rejoinedPath = path.join(tmpDir, "rejoined.json");

  execFileSync("node", [path.join(scriptsDir, "split.js"), inputPath, tmpDir], { stdio: "inherit" });
  execFileSync("node", [path.join(scriptsDir, "join.js"), tmpDir, rejoinedPath], { stdio: "inherit" });

  const original = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const rejoined = JSON.parse(fs.readFileSync(rejoinedPath, "utf8"));

  assert.deepStrictEqual(rejoined, original, "Rejoined document differs from the original");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Round-trip OK: ${inputPath} === split -> join`);
}

main();
