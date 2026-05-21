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

test("submitting text enters provider execution flow (no local echo)", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <Shell />
    </RTUIProvider>,
  );
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 300));
  const frame = lastFrame() ?? "";
  // User input appears in scrollback (not just prompt)
  expect(frame).toContain("hello");
  // Echo stub is gone — real pipeline is used
  expect(frame).not.toContain("echo: hello");
  // Status will be either Thinking (subprocess running) or some pipeline result
  // but NEVER "echo: hello" from the old stub
});
