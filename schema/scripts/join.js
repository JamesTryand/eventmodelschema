#!/usr/bin/env node
// Joins a manifest + the files it references back into a single
// EventModeling document -- the exact inverse of split.js. The result is
// expected to validate against eventmodeling.schema.json unchanged.
//
// Usage: node scripts/join.js <manifestDir> [outputFile]
// With no outputFile, prints the joined document to stdout.

const fs = require("fs");
const path = require("path");

function main() {
  const [, , manifestDir, outputFile] = process.argv;
  if (!manifestDir) {
    console.error("Usage: node scripts/join.js <manifestDir> [outputFile]");
    process.exit(1);
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(manifestDir, "manifest.json"), "utf8")
  );
  const schemaId = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "eventmodeling.schema.json"), "utf8")
  ).$id;

  const doc = {
    $schema: schemaId,
    eventModelingSchemaVersion: manifest.eventModelingSchemaVersion,
    id: manifest.id,
    name: manifest.name,
    ...(manifest.description !== undefined ? { description: manifest.description } : {}),
    swimlanes: manifest.swimlanes
  };

  for (const [key, relPath] of Object.entries(manifest.registries || {})) {
    doc[key] = JSON.parse(fs.readFileSync(path.join(manifestDir, relPath), "utf8"));
  }

  doc.slices = (manifest.slices || []).map((relPath) =>
    JSON.parse(fs.readFileSync(path.join(manifestDir, relPath), "utf8"))
  );

  const json = JSON.stringify(doc, null, 2) + "\n";
  if (outputFile) {
    fs.writeFileSync(outputFile, json);
    console.log(`Joined ${manifestDir} -> ${outputFile}`);
  } else {
    process.stdout.write(json);
  }
}

main();
