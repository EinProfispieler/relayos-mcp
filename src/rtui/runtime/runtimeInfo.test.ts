import { test, expect } from "bun:test";
import { getRuntimeView } from "./runtimeInfo.js";

test("returns a RuntimeView with non-empty projectDir and model", () => {
  const view = getRuntimeView();
  expect(view.projectDir.length).toBeGreaterThan(0);
  expect(view.model.length).toBeGreaterThan(0);
  expect(["low", "medium", "high"]).toContain(view.effort);
});

test("branch is a string (empty allowed if not git repo)", () => {
  const view = getRuntimeView();
  expect(typeof view.branch).toBe("string");
});
