import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = fileURLToPath(new URL("../src/overseer/templates", import.meta.url));

function read(name: string): string {
  return readFileSync(join(TEMPLATES, name), "utf8");
}

describe("overseer policy templates", () => {
  it("OPERATING_POLICY allows supervised build-mode continuation", () => {
    const text = read("OPERATING_POLICY.md");
    expect(text).toContain("Foreground supervised continuation loop");
    expect(text).toContain("User can interrupt at any time");
  });

  it("OPERATING_POLICY still forbids daemons and detached runners", () => {
    const text = read("OPERATING_POLICY.md");
    expect(text).toContain("Daemon / background runners");
    expect(text).toContain("Detached execution while the user is not watching");
  });

  it("FORBIDDEN_ACTIONS permits additive optional fields", () => {
    const text = read("FORBIDDEN_ACTIONS.md");
    expect(text).toContain("no breaking format changes");
    expect(text).toContain("Additive optional fields");
  });

  it("MODEL_POLICY names the model-selection priority", () => {
    const text = read("MODEL_POLICY.md");
    expect(text).toContain("correctness and safety over token saving");
    expect(text.toLowerCase()).toContain("effort");
  });
});
