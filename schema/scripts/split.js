#!/usr/bin/env node
// Splits a single EventModeling document into a manifest + one file per
// registry + one file per slice. See docs/design-notes.md ("v2 M3") for why.
//
// Usage: node scripts/split.js <input.json> <outDir>

const fs = require("fs");
const path = require("path");

const REGISTRY_KEYS = [
  "chapters",
  "actorLanes",
  "events",
  "commands",
  "readModels",
  "screens",
  "automations",
  "hotspots"
];

function main() {
  const [, , inputPath, outDir] = process.argv;
  if (!inputPath || !outDir) {
    console.error("Usage: node scripts/split.js <input.json> <outDir>");
    process.exit(1);
  }

  const doc = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  fs.mkdirSync(outDir, { recursive: true });
  const registriesDir = path.join(outDir, "registries");
  const slicesDir = path.join(outDir, "slices");

  const manifest = {
    eventModelingSchemaVersion: doc.eventModelingSchemaVersion,
    id: doc.id,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    swimlanes: doc.swimlanes
  };

  const registryPaths = {};
  for (const key of REGISTRY_KEYS) {
    const value = doc[key];
    if (value && Object.keys(value).length > 0) {
      fs.mkdirSync(registriesDir, { recursive: true });
      const relPath = path.join("registries", `${key}.json`);
      fs.writeFileSync(path.join(outDir, relPath), JSON.stringify(value, null, 2) + "\n");
      registryPaths[key] = relPath.split(path.sep).join("/");
    }
  }
  if (Object.keys(registryPaths).length > 0) {
    manifest.registries = registryPaths;
  }

  const slicePaths = [];
  if (doc.slices && doc.slices.length > 0) {
    fs.mkdirSync(slicesDir, { recursive: true });
    for (const slice of doc.slices) {
      const relPath = path.join("slices", `${slice.id}.json`);
      fs.writeFileSync(path.join(outDir, relPath), JSON.stringify(slice, null, 2) + "\n");
      slicePaths.push(relPath.split(path.sep).join("/"));
    }
  }
  manifest.slices = slicePaths;

  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`Split ${inputPath} -> ${outDir} (${slicePaths.length} slice file(s), ${Object.keys(registryPaths).length} registry file(s))`);
}

main();
