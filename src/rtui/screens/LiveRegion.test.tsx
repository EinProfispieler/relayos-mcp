import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { LiveRegion } from "./LiveRegion.js";

test("renders nothing when live is empty", () => {
  const { lastFrame } = render(
    <LiveRegion spinner={null} streaming={null} progress={null} />,
  );
  expect((lastFrame() ?? "").trim()).toBe("");
});

test("renders spinner glyph when spinner is set", () => {
  const { lastFrame } = render(
    <LiveRegion spinner="⠋" streaming={null} progress={null} />,
  );
  expect(lastFrame()).toContain("⠋");
});

test("renders streaming text when set", () => {
  const { lastFrame } = render(
    <LiveRegion spinner={null} streaming="thinking..." progress={null} />,
  );
  expect(lastFrame()).toContain("thinking...");
});

test("renders both spinner and streaming text together", () => {
  const { lastFrame } = render(
    <LiveRegion spinner="⠋" streaming="partial reply" progress={null} />,
  );
  expect(lastFrame()).toContain("⠋");
  expect(lastFrame()).toContain("partial reply");
});
