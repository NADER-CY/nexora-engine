import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { PRODUCT_IDENTITY } from "../../src/identity.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { processTest } from "../support/process/processFixture.js";

const jsonExamples = (content: string): unknown[] =>
  [...content.matchAll(/```json\s*([\s\S]*?)```/gu)].map((match): unknown =>
    JSON.parse(match[1] ?? ""),
  );

describe("onboarding documentation product facts", () => {
  it.each([
    ["docs/native-investigation.md", "raw-binary.md#nmos-6502"],
    ["docs/ghidra-riscv.md", "raw-binary.md"],
  ])(
    "routes raw admission guidance in %s to the owning guide",
    async (path, target) => {
      const content = await readFile(resolve(path), "utf8");
      const links = [...content.matchAll(/\]\(([^)\s]+)\)/gu)].map(
        (match) => match[1],
      );
      expect(links, path).toContain(target);
    },
  );

  it("keeps the source-distribution MCP example local and registry-free", async () => {
    const content = await readFile(resolve("docs/mcp/generic-client.md"), "utf8");
    expect(PRODUCT_IDENTITY.registryPackage).toBeNull();
    expect(jsonExamples(content)).toContainEqual({
      mcpServers: {
        "nexora-engine": {
          command: "node",
          args: ["/absolute/path/to/nexora-engine/scripts/nexora-engine.mjs", "mcp"],
        },
      },
    });
    expect(content).not.toContain("npx rea-agents");
  });

  it("keeps language landing pages current, honest and free of upstream acquisition", async () => {
    const inventory = JSON.parse(await readFile(resolve("website/locales/languages.json"), "utf8")) as { code: string; readme: string }[];
    const paths = inventory.filter(language => language.code !== "en").map(language => language.readme);
    const editions = (await readdir(resolve("docs/readme"))).filter(name => /^README_[A-Za-z0-9-]+\.md$/u.test(name)).map(name => `docs/readme/${name}`);
    expect([...paths].sort()).toEqual(editions.sort());
    expect(paths).toContain("docs/readme/README_it.md");
    expect(paths).toContain("docs/readme/README_el.md");
    for (const path of paths) {
      const content = await readFile(resolve(path), "utf8");
      expect(content, path).toContain("# NEXORA ENGINE");
      expect(content, path).toContain("../../README.md");
      expect(content, path).toContain("has not been verified");
      expect(content, path).not.toMatch(/\bREA\b|rea-agents|rea\.tools|npm install|npx /u);
    }
  });

  it("keeps the Persian guide linked to maintained workflows without stale release claims", async () => {
    const persian = await readFile(resolve("NEXORA_README_FA.md"), "utf8");
    for (const path of ["README.md", "docs/installation/windows.md", "docs/installation/linux.md", "docs/installation/macos.md", "docs/mcp/README.md", "NOTICE.md"]) expect(persian).toContain(`](${path})`);
    expect(persian).toContain("node nexora/bin/nexora.mjs analyze-project examples/tutorial/cycle");
    expect(persian).not.toMatch(/\bREA\b|rea-agents|rea\.tools|NEXORA 0\.5/u);
  });

});

describe("published performance evidence", () => {
  const script = resolve(
    "tests/support/analysis-efficiency/mcp-integer-report.mjs",
  );
  const report = resolve(
    "docs/verification/analysis-efficiency/mcp-integer-allocation.md",
  );
  processTest(
    "keeps generated report facts aligned with committed receipts",
    async ({ processes }) => {
      const result = await processes.run(process.execPath, [script, "--check"]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    },
  );
  for (const section of ["normal", "heap"]) {
    processTest(
      `rejects stale ${section} measurements without rewriting the report`,
      async ({ processes }) => {
        const source = await readFile(report, "utf8");
        const begin = `<!-- BEGIN:allocation-report:${section} -->`;
        const end = `<!-- END:allocation-report:${section} -->`;
        const start = source.indexOf(begin) + begin.length;
        const finish = source.indexOf(end);
        const block = source.slice(start, finish);
        const stale = block.replace(/\d+\.\d{3}/u, (value) =>
          (Number(value) + 1).toFixed(3),
        );
        expect(stale).not.toBe(block);
        const path = resolve(
          await createTestTempDirectory("rea-report-stale-"),
          "report.md",
        );
        const content = source.slice(0, start) + stale + source.slice(finish);
        await writeFile(path, content);
        const result = await processes.run(process.execPath, [
          script,
          "--check",
          "--markdown",
          path,
        ]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(
          `Generated allocation report differs: ${section}`,
        );
        expect(await readFile(path, "utf8")).toBe(content);
      },
    );
  }
  processTest(
    "refuses missing producer markers before writing",
    async ({ processes }) => {
      const source = await readFile(report, "utf8");
      const content = source.replace(
        "<!-- BEGIN:allocation-report:normal -->",
        "",
      );
      expect(content).not.toBe(source);
      const path = resolve(
        await createTestTempDirectory("rea-report-marker-"),
        "report.md",
      );
      await writeFile(path, content);
      const result = await processes.run(process.execPath, [
        script,
        "--markdown",
        path,
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "Expected one opening report marker: normal",
      );
      expect(await readFile(path, "utf8")).toBe(content);
    },
  );
});
