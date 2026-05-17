import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "./App.js";

test("App mounts, accepts input, and echoes reply", async () => {
  const { lastFrame, stdin } = render(<App />);
  stdin.write("smoke");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 60));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯ smoke");
  expect(frame).toContain("echo: smoke");
});
