import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("overseer binary", () => {
  it("package.json declares both overseer and relays bins", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.bin.overseer).toBe("bin/overseer");
    expect(pkg.bin.relays).toBe("bin/relays");
  });

  it("bin/overseer exists and is executable", () => {
    const p = join(ROOT, "bin", "overseer");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).mode & 0o111).toBeGreaterThan(0);
  });

  it("bin/relays forwards to overseer and is executable", () => {
    const p = join(ROOT, "bin", "relays");
    expect(statSync(p).mode & 0o111).toBeGreaterThan(0);
    const text = readFileSync(p, "utf8");
    expect(text).toMatch(/exec\s+"\$DIR\/overseer"\s+"\$@"/);
  });
});
