import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { RTUIProvider } from "../state/context.js";
import { InputRow } from "./InputRow.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

test("renders prompt prefix", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("❯");
});

test("typed characters appear in the input", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  stdin.write("hi");
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame()).toContain("hi");
});

test("Enter clears the input", async () => {
  const { lastFrame, stdin } = render(
    <RTUIProvider runtime={runtime}>
      <InputRow />
    </RTUIProvider>,
  );
  stdin.write("hello");
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\r");
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame()).not.toContain("hello");
});
