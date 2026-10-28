// Preload hook: record peak RSS (KiB) when the measured process exits normally.
import { writeFileSync } from "node:fs";

const target = process.env.NEXORA_RSS_FILE;
if (target) {
  process.on("exit", () => {
    try {
      writeFileSync(target, JSON.stringify({ maxRssKb: process.resourceUsage().maxRSS }));
    } catch {
      /* best effort */
    }
  });
}
