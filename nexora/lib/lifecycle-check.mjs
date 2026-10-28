/**
 * Install-time code execution audit.
 *
 * npm runs `preinstall`/`install`/`postinstall`/`prepare` scripts of the root
 * project and `pre/post/install` scripts of dependencies during `npm ci`
 * unless `--ignore-scripts` is used. This module compares what the project
 * and its lockfile declare against a reviewed allowlist, so any new
 * install-time script is a test failure that forces a human review.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Root lifecycle hooks npm may run automatically. */
export const ROOT_HOOKS = [
  "preinstall", "install", "postinstall",
  "preprepare", "prepare", "postprepare",
  "prepack", "postpack",
  "prepublish", "prepublishOnly", "publish", "postpublish",
  "dependencies",
];

/**
 * Reviewed state (see SECURITY_AUDIT.md, "Install-time scripts").
 * Root hooks map to their exact reviewed command; dependency entries are
 * "<lockfile path>@<version>".
 */
export const REVIEWED = Object.freeze({
  rootHooks: {
    prepare: "node scripts/prepare.mjs",
    prepack: "node scripts/prepack.mjs",
    prepublishOnly: "npm run verify:windows-native:artifact",
  },
  dependencyInstallScripts: [
    "node_modules/esbuild@0.28.2",
    "node_modules/frida@17.23.2",
    "node_modules/fsevents@2.3.3",
    "node_modules/vitepress/node_modules/esbuild@0.25.12",
  ],
});

/**
 * @param {string} root project directory
 * @returns {Promise<{rootHooks: Record<string,string>, dependencyInstallScripts: string[],
 *   unreviewed: {rootHooks: string[], dependencies: string[]}, changed: string[], ok: boolean}>}
 */
export async function auditLifecycleScripts(root, reviewed = REVIEWED) {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  const rootHooks = Object.fromEntries(ROOT_HOOKS.filter((h) => h in scripts).map((h) => [h, scripts[h]]));
  const dependencyInstallScripts = Object.entries(lock.packages ?? {})
    .filter(([path, meta]) => path !== "" && meta?.hasInstallScript)
    .map(([path, meta]) => `${path}@${meta.version}`)
    .sort();
  const unreviewedHooks = Object.keys(rootHooks).filter((h) => !(h in reviewed.rootHooks));
  const changed = Object.keys(rootHooks).filter((h) => h in reviewed.rootHooks && reviewed.rootHooks[h] !== rootHooks[h]);
  const unreviewedDeps = dependencyInstallScripts.filter((d) => !reviewed.dependencyInstallScripts.includes(d));
  return {
    rootHooks,
    dependencyInstallScripts,
    unreviewed: { rootHooks: unreviewedHooks, dependencies: unreviewedDeps },
    changed,
    ok: unreviewedHooks.length === 0 && changed.length === 0 && unreviewedDeps.length === 0,
  };
}
