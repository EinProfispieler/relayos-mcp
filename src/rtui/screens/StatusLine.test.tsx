import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "../state/context.js";
import { StatusLine } from "./StatusLine.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "GID",
  branch: "production",
  model: "gpt-5.3-codex",
  effort: "medium",
  isGitRepo: true,
};

test("renders model and effort", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("gpt-5.3-codex");
  expect(lastFrame()).toContain("medium");
});

test("renders project dir prefixed with ~/", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("~/GID");
});

test("renders branch name", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("production");
});

test("renders Ready when status is idle", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <StatusLine />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("Ready");
});
