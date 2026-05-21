import { describe, expect, it } from "vitest";
import { OVERSEER_ROLE_TEXT } from "../src/overseer/role.js";

describe("OVERSEER_ROLE_TEXT", () => {
  it("is a non-empty identity string", () => {
    expect(typeof OVERSEER_ROLE_TEXT).toBe("string");
    expect(OVERSEER_ROLE_TEXT.trim().length).toBeGreaterThan(200);
  });

  it("names the Overseer and its coordinating role", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("RelayOS Overseer");
    expect(OVERSEER_ROLE_TEXT).toContain("coordinator");
  });

  it("defines the core vocabulary", () => {
    for (const term of ["HANDOFF", "AUDIT", "CHECKPOINT", "EVENT LOG", "PROJECTED STATE"]) {
      expect(OVERSEER_ROLE_TEXT).toContain(term);
    }
  });

  it("defines step mode and build mode", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("STEP MODE");
    expect(OVERSEER_ROLE_TEXT).toContain("BUILD MODE");
  });

  it("states the hard approval boundaries", () => {
    expect(OVERSEER_ROLE_TEXT).toContain("HARD APPROVAL BOUNDARY");
    expect(OVERSEER_ROLE_TEXT).toContain("explicit user approval");
    expect(OVERSEER_ROLE_TEXT).toContain("no background runner");
  });
});
