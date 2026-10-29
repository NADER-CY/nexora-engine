// Fork identity, update guard and MCP registration. Imports TypeScript
// sources through the repository's pure-Node loader (no tsx needed):
//   node --test nexora/test/fork-identity.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { REPO, runNode, importRepoSource } from "./helpers.mjs";

// importRepoSource() passes a pathToFileURL() URL (a raw Windows path given to
// import() fails with ERR_UNSUPPORTED_ESM_URL_SCHEME) to the pure-Node
// TypeScript loader in scripts/lib/verifier-source-loader.mjs.
const { PRODUCT_IDENTITY } = await importRepoSource("src", "identity.ts");
const { runUpdate, updateInstallCommand } = await importRepoSource("src", "application", "Update.ts");
const reg = await importRepoSource("src", "application", "ClientRegistrationIdentity.ts");

const okResult = (value) => ({ ok: true, value });

function fakeHost(log) {
  const installation = { manager: "npm", prefix: "/fixture", packageRoot: "/fixture/lib/node_modules/x" };
  let installed = "3.2.1";
  return {
    installation: async () => (log.push("installation"), installation),
    latestVersion: async () => (log.push("latestVersion"), okResult("3.3.0")),
    installVersion: async (_i, v) => (log.push("installVersion"), (installed = v), okResult(undefined)),
    installedVersion: async () => (log.push("installedVersion"), okResult(installed)),
    planMaintenance: async () => ({ status: "current" }),
  };
}

test("identity: NEXORA ENGINE branding with upstream attribution, no registry package", () => {
  assert.equal(PRODUCT_IDENTITY.displayName, "NEXORA ENGINE");
  assert.equal(PRODUCT_IDENTITY.packageName, "nexora-engine");
  assert.equal(PRODUCT_IDENTITY.mcpServerKey, "nexora-engine");
  assert.equal(PRODUCT_IDENTITY.cliBinary, "nexora-engine", "primary CLI uses the product name; package retains the rea alias");
  assert.equal(PRODUCT_IDENTITY.registryPackage, null);
  assert.equal(PRODUCT_IDENTITY.upstream.repository, "https://github.com/morluto/rea");
  assert.equal(PRODUCT_IDENTITY.upstream.license, "MIT");
});

test("rea update: refuses by default without touching the registry or installing", async () => {
  const log = [];
  const r = await runUpdate("6.8.0", fakeHost(log));
  assert.equal(r.status, "failed");
  assert.equal(r.reason, "unpublished-distribution");
  assert.match(r.remediation, /NEXORA ENGINE is distributed from source/);
  assert.match(r.remediation, /upstream REA/);
  assert.deepEqual(log, [], "no lookup, no install");
});

test("rea update: the update machinery still works when a registry package is explicitly configured", async () => {
  const log = [];
  const r = await runUpdate("3.2.1", fakeHost(log), "human", "nexora-engine");
  assert.equal(r.status, "updated");
  assert.deepEqual(r.command.slice(-1), ["nexora-engine@3.3.0"]);
  assert.ok(log.includes("installVersion"));
});

test("updateInstallCommand: never builds a command without a registry package", () => {
  const inst = { manager: "npm", prefix: "/p", packageRoot: "/p/x" };
  assert.throws(() => updateInstallCommand(inst, "1.0.0"), /no registry package/);
  assert.ok(!updateInstallCommand(inst, "1.0.0", "nexora-engine").some((a) => a.includes("rea-agents")));
});

test("MCP registration: package-runner and default commands resolve to the local launcher, never npx", () => {
  for (const platform of ["linux", "win32", "darwin"])
    for (const runner of ["npx", "bunx"]) {
      const cmd = reg.packageRunnerRegistrationCommand(runner, platform);
      assert.ok(!cmd.some((a) => /^(npx|bunx|cmd(\.exe)?)$/i.test(a) || a.includes("rea-agents") || a.includes("@")), `${runner}/${platform}: ${cmd}`);
    }
  const local = reg.npxRegistrationCommand();
  assert.equal(local[0], process.execPath);
  assert.equal(local.at(-1), "mcp");
  assert.deepEqual(reg.localRegistrationCommand("/opt/nexora/scripts/rea.mjs", "/usr/bin/node"), ["/usr/bin/node", "/opt/nexora/scripts/rea.mjs", "mcp"]);
  assert.deepEqual(reg.localRegistrationCommand(""), [], "unknown entrypoint yields no command (setup reports a blocker)");
});

test("MCP registration: upstream and unpublished npx references are foreign, so setup never adopts them silently", () => {
  for (const ref of ["rea-agents@6.8.0", "rea-agents@latest", "rea-agents", "nexora-engine@6.8.0", "nexora-engine@latest"])
    assert.equal(reg.classifyClientRegistrationCommand(["npx", "-y", ref, "mcp"], undefined), "foreign", ref);
  assert.equal(reg.classifyClientRegistrationCommand(["cmd.exe", "/d", "/c", "npx", "-y", "rea-agents@6.8.0", "mcp"], undefined), "foreign");
});

test("MCP registration: the local runtime+script form is owned", () => {
  const entry = join(REPO, "scripts", "rea.mjs");
  assert.equal(reg.classifyClientRegistrationCommand([process.execPath, entry, "mcp"], entry), "owned");
});

test("plugin launcher: validates the nexora-engine package identity", async () => {
  const r = await runNode(["scripts/plugin-mcp-launcher.mjs", "0.0.1"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /NEXORA ENGINE plugin version pin does not match its installed nexora-engine package/);
});

test("packaging: private, NEXORA bins, no upstream publish identity", async () => {
  const pkg = JSON.parse(await readFile(join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.name, "nexora-engine");
  assert.equal(pkg.private, true);
  assert.equal(pkg.publishConfig, undefined);
  assert.equal(pkg.mcpName, undefined);
  assert.deepEqual(Object.keys(pkg.bin).sort(), ["nexora", "nexora-engine", "rea"]);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.nexora.upstream.repository, "https://github.com/morluto/rea");
  for (const f of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
    const p = JSON.parse(await readFile(join(REPO, f), "utf8"));
    assert.equal(p.name, "nexora-engine");
    assert.ok(!JSON.stringify(p).includes("rea.tools"));
  }
  const server = JSON.parse(await readFile(join(REPO, "server.json"), "utf8"));
  assert.ok(!server.name.includes("morluto"));
});

test("CI: no active workflow publishes, deploys or uses OIDC/registry credentials", async () => {
  const dir = join(REPO, ".github", "workflows");
  for (const f of await readdir(dir)) {
    const text = await readFile(join(dir, f), "utf8");
    assert.ok(!/npm publish|wrangler|cloudflare|id-token:\s*write|NPM_TOKEN|RELEASE_PLEASE_TOKEN|CLOUDFLARE_|publish-mcp|mcp-publisher/i.test(text), f);
  }
  const actions = await readdir(join(REPO, ".github", "actions"));
  assert.ok(!actions.includes("publish-mcp") && !actions.includes("prepare-release-package"));
});
