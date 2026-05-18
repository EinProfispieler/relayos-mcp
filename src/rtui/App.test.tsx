import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "./App.js";

test("App mounts, accepts input, and enters provider execution flow", async () => {
  const { lastFrame, stdin } = render(<App />);
  stdin.write("smoke");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 300));
  const frame = lastFrame() ?? "";
  // User input appears; echo stub is removed
  expect(frame).toContain("smoke");
  expect(frame).not.toContain("echo: smoke");
});
