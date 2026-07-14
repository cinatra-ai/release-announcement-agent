// Kind-gate acceptance: this repo (the release-announcement project agent)
// passes the self-contained extension-kind-gate (the author-facing mirror of
// the host install pipeline), and broken variants are refused pre-publish.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const GATE = join(ROOT, "extension-kind-gate.mjs");

function runGate(packageRoot) {
  return spawnSync(process.execPath, [GATE, "--package-root", packageRoot], { encoding: "utf8" });
}

/** Synthesize a throwaway copy of this package's publish payload (manifest +
 *  template + README + LICENSE) so a test can mutate it and assert the gate
 *  refuses, without touching the committed tree. */
function synthesizePackage() {
  const dir = mkdtempSync(join(tmpdir(), "release-announcement-"));
  cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
  cpSync(join(ROOT, "README.md"), join(dir, "README.md"));
  cpSync(join(ROOT, "LICENSE"), join(dir, "LICENSE"));
  mkdirSync(join(dir, "cinatra"), { recursive: true });
  cpSync(join(ROOT, "cinatra", "project-template.json"), join(dir, "cinatra", "project-template.json"));
  return dir;
}

test("this repo (the release-announcement project agent) passes the agent kind gate", () => {
  const r = runGate(ROOT);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("dropping the manifest dependency edge makes the gate REFUSE the template (one truth source)", () => {
  const dir = synthesizePackage();
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    pkg.cinatra.dependencies = [];
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg, null, 2));
    const r = runGate(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /worker_not_in_dependencies/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a structurally invalid template is refused at the gate, pre-publish", () => {
  const dir = synthesizePackage();
  try {
    const tpl = JSON.parse(readFileSync(join(dir, "cinatra", "project-template.json"), "utf8"));
    tpl.tasks[0].dependsOn = ["announce"]; // kickoff <- announce: a cycle
    writeFileSync(join(dir, "cinatra", "project-template.json"), JSON.stringify(tpl, null, 2));
    const r = runGate(dir);
    assert.notEqual(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the manifest is a specific project agent: one role-keyed worker edge, consumes nothing", () => {
  // Mirror-image of the PM SEAT predicate — a SPECIFIC project agent ships the
  // template + its worker dependency edges and consumes no capability (the
  // generic project-manager agent, not this package, holds the pm-work-store
  // seat). The one worker edge is what the "one truth source" rule checks the
  // template's launch-blog-writer binding against.
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.cinatra.kind, "agent");
  assert.deepEqual(pkg.cinatra.consumes, []);
  const deps = pkg.cinatra.dependencies;
  assert.equal(deps.length, 1);
  assert.equal(deps[0].packageName, "@cinatra-ai/blog-pipeline-agent");
  assert.equal(deps[0].requirement, "required");
});
