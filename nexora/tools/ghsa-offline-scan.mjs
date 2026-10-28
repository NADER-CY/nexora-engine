#!/usr/bin/env node
/**
 * Offline dependency vulnerability scan against a local checkout of GitHub's
 * public advisory database (https://github.com/github/advisory-database,
 * directory advisories/github-reviewed, OSV format).
 *
 * Matches every package version locked in package-lock.json (including
 * nested copies and npm aliases) against the npm advisories' affected ranges.
 * Withdrawn advisories are ignored. No network access, no installation.
 *
 * Usage:
 *   node nexora/tools/ghsa-offline-scan.mjs <advisory-db-dir> [package-lock.json] [--json out.json]
 * Exit code: 0 no critical/high findings, 1 critical/high present, 2 usage error.
 *
 * Requires the `semver` package (a runtime dependency of this project).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MODERATE", "LOW", "UNKNOWN"];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".json")) yield p;
  }
}

/** Collect locked packages: name -> [{version, paths[], dev, optional}] */
export function lockedPackages(lock) {
  const out = new Map();
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (path === "" || meta.link || !meta.version) continue;
    const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const list = out.get(name) ?? [];
    let entry = list.find((e) => e.version === meta.version);
    if (!entry) list.push((entry = { version: meta.version, paths: [], dev: true, optional: true }));
    entry.paths.push(path);
    entry.dev &&= Boolean(meta.dev);
    entry.optional &&= Boolean(meta.optional || meta.devOptional);
    out.set(name, list);
  }
  return out;
}

/** Is `version` affected by one OSV `affected` entry? Returns the matching range text or null. */
export function affectedBy(version, affected) {
  if (Array.isArray(affected.versions) && affected.versions.includes(version)) return `listed ${version}`;
  for (const range of affected.ranges ?? []) {
    if (range.type !== "SEMVER" && range.type !== "ECOSYSTEM") continue;
    // OSV events are ordered: introduced / fixed / last_affected pairs.
    let introduced = null;
    for (const ev of range.events ?? []) {
      if (ev.introduced !== undefined) introduced = ev.introduced;
      else if ((ev.fixed !== undefined || ev.last_affected !== undefined) && introduced !== null) {
        const lowerOk = introduced === "0" || semver.gte(version, introduced, { loose: true });
        const upperOk = ev.fixed !== undefined ? semver.lt(version, ev.fixed, { loose: true }) : semver.lte(version, ev.last_affected, { loose: true });
        if (lowerOk && upperOk) return ev.fixed !== undefined ? `>=${introduced} <${ev.fixed}` : `>=${introduced} <=${ev.last_affected}`;
        introduced = null;
      }
    }
    if (introduced !== null && (introduced === "0" || semver.gte(version, introduced, { loose: true }))) return `>=${introduced} (no fix)`;
  }
  return null;
}

function fixedVersions(affected) {
  const fixes = [];
  for (const range of affected.ranges ?? []) for (const ev of range.events ?? []) if (ev.fixed) fixes.push(ev.fixed);
  return fixes;
}

export async function scan(dbDir, lockPath) {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const pkgs = lockedPackages(lock);
  const findings = [];
  let advisoriesRead = 0;
  let npmAdvisories = 0;
  let withdrawn = 0;
  let parseErrors = 0;
  for await (const file of walk(dbDir)) {
    advisoriesRead++;
    let adv;
    try {
      adv = JSON.parse(await readFile(file, "utf8"));
    } catch {
      parseErrors++;
      continue;
    }
    const npmAffected = (adv.affected ?? []).filter((a) => a.package?.ecosystem === "npm");
    if (!npmAffected.length) continue;
    npmAdvisories++;
    if (adv.withdrawn) {
      withdrawn++;
      continue;
    }
    for (const a of npmAffected) {
      const locked = pkgs.get(a.package.name);
      if (!locked) continue;
      for (const entry of locked) {
        if (!semver.valid(entry.version, { loose: true })) continue;
        const match = affectedBy(entry.version, a);
        if (!match) continue;
        findings.push({
          id: adv.id,
          aliases: (adv.aliases ?? []).filter((x) => x.startsWith("CVE-")),
          severity: (adv.database_specific?.severity ?? "UNKNOWN").toUpperCase(),
          package: a.package.name,
          version: entry.version,
          scope: entry.dev ? (entry.optional ? "dev-optional" : "dev") : entry.optional ? "optional" : "runtime",
          paths: entry.paths,
          affectedRange: match,
          fixedIn: fixedVersions(a),
          summary: String(adv.summary ?? "").slice(0, 200),
          published: adv.published,
          modified: adv.modified,
        });
      }
    }
  }
  findings.sort((x, y) => SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity) || x.package.localeCompare(y.package));
  const count = (s) => findings.filter((f) => f.severity === s).length;
  return {
    schema: "nexora-ghsa-offline-scan/v1",
    lockfile: lockPath.split(/[\\/]/).pop(),
    lockedPackageVersions: [...pkgs.values()].reduce((n, l) => n + l.length, 0),
    advisoriesRead,
    npmAdvisories,
    withdrawnIgnored: withdrawn,
    parseErrors,
    summary: Object.fromEntries(SEVERITY_ORDER.map((s) => [s.toLowerCase(), count(s)])),
    findings,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf("--json");
  const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : undefined;
  const [db, lockPath = "package-lock.json"] = args;
  if (!db) {
    process.stderr.write("Usage: node nexora/tools/ghsa-offline-scan.mjs <advisory-db-dir> [package-lock.json] [--json out.json]\n");
    process.exit(2);
  }
  const report = await scan(db, lockPath);
  if (jsonOut) await writeFile(jsonOut, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`advisories read: ${report.advisoriesRead} (npm: ${report.npmAdvisories}, withdrawn ignored: ${report.withdrawnIgnored}, parse errors: ${report.parseErrors})\n`);
  process.stdout.write(`locked package versions: ${report.lockedPackageVersions}\n`);
  process.stdout.write(`findings: ${JSON.stringify(report.summary)}\n`);
  for (const f of report.findings) process.stdout.write(`${f.severity.padEnd(9)} ${f.id} ${f.package}@${f.version} [${f.scope}] fixed: ${f.fixedIn.join(", ") || "none"} — ${f.summary}\n`);
  process.exitCode = report.summary.critical + report.summary.high > 0 ? 1 : 0;
}
