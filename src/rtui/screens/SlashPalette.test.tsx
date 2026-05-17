import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { useEffect } from "react";
import { RTUIProvider, useRTUI } from "../state/context.js";
import { SlashPalette } from "./SlashPalette.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "t",
  branch: "main",
  model: "s",
  effort: "medium",
  isGitRepo: true,
};

function Seed({ query, sel }: { query: string; sel: number }) {
  const { dispatch } = useRTUI();
  useEffect(() => {
    dispatch({ type: "SLASH_OPEN" });
    dispatch({ type: "SLASH_QUERY", query });
    for (let i = 0; i < sel; i++) {
      dispatch({ type: "SLASH_MOVE", delta: 1, visibleCount: 99 });
    }
  }, [query, sel, dispatch]);
  return null;
}

test("renders matching commands with descriptions", async () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/r" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  const frame = lastFrame() ?? "";
  expect(frame).toContain("/recent");
  expect(frame).toContain("/results");
  expect(frame).toContain("/run");
  expect(frame).toContain("coming soon");
});

test("hidden when palette.visible is false", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <SlashPalette />
    </RTUIProvider>,
  );
  expect(lastFrame() ?? "").toBe("");
});

test("renders empty-state when filter matches nothing", async () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/zzz" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame() ?? "").toContain("no matching commands");
});

test("Down arrow advances selectedIndex", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\x1b[B"); // Down arrow
  await new Promise((r) => setTimeout(r, 30));
  const frame = lastFrame() ?? "";
  const lines = frame.split("\n");
  const highlightedLine = lines.find((l) => l.includes("❯ /status"));
  expect(highlightedLine).toBeDefined();
});

test("Escape closes the palette", async () => {
  const { stdin, lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Seed query="/" sel={0} />
      <SlashPalette />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 30));
  stdin.write("\x1b"); // Esc
  await new Promise((r) => setTimeout(r, 30));
  expect(lastFrame() ?? "").not.toContain("/help");
});
