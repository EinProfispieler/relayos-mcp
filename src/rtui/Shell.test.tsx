import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "./state/context.js";
import { Shell } from "./Shell.js";
import type { RuntimeView } from "./state/types.js";

const runtime: RuntimeView = {
  projectDir: "GID",
  branch: "production",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

test("Shell mounts and renders prompt + status line", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯");
  expect(frame).toContain("stub");
  expect(frame).toContain("production");
});

test("submitting text appends echo reply to scrollback", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 50));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("❯ hello");
  expect(frame).toContain("echo: hello");
});

test("submitting /help runs slash command instead of echo", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  stdin.write("/help");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 60));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("/help");
  expect(frame).not.toContain("echo: /help");
  expect(frame).toContain("/status");
});
