/**
 * Canonical public identity shared by packaging, setup, MCP, and skill install.
 * Centralization prevents persistent client registrations from drifting from
 * the npm package or executable exposed in package.json.
 */
export const PRODUCT_IDENTITY = {
  displayName: "NEXORA ENGINE",
  packageName: PACKAGE_METADATA.name,
  packageSpecifier: `${PACKAGE_METADATA.name}@latest`,
  registrationPackageSpecifier: `${PACKAGE_METADATA.name}@${PACKAGE_METADATA.version}`,
  packageVersion: PACKAGE_METADATA.version,
  cliBinary: "rea",
  mcpCommand: `npx -y ${PACKAGE_METADATA.name}@${PACKAGE_METADATA.version} mcp`,
  mcpServerKey: "nexora-engine",
  skillName: "reverse-engineer-anything",
  skillVersion: PACKAGE_METADATA.skillVersion,
  configFileName: "rea.json",
  /**
   * npm package this build may self-update from and register through npx/bunx.
   * null means a source/local distribution: `rea update` is disabled and MCP
   * registration always uses the local runtime + script, so no command ever
   * resolves a package name from the public registry. Set this only once the
   * fork controls a published package of that exact name.
   */
  registryPackage: null as string | null,
  /** Upstream origin, retained for attribution (MIT). */
  upstream: {
    name: "REA (Reverse Engineer Anything)",
    repository: "https://github.com/morluto/rea",
    license: "MIT",
  },
} as const;

/** Exact SDK package identities, distinct from negotiated protocol version. */
export const SDK_IDENTITY = {
  server: PACKAGE_METADATA.serverSdkVersion,
  client_test: PACKAGE_METADATA.clientSdkVersion,
  core: PACKAGE_METADATA.coreSdkVersion,
} as const;
import { PACKAGE_METADATA } from "./generatedPackageMetadata.js";
