import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { WelcomeBanner } from "./WelcomeBanner.js";

test("renders banner art, recent activity placeholder, and three tips", () => {
  const { lastFrame } = render(<WelcomeBanner recent={[]} />);
  const frame = lastFrame() ?? "";
  expect(frame).toContain("RelayOS");
  expect(frame).toContain("Recent activity");
  expect(frame).toContain("(none)");
  expect(frame).toContain("Type / to open");
  expect(frame).toContain("↑/↓");
  expect(frame).toContain("/help");
});

test("renders provided recent lines (up to 3)", () => {
  const { lastFrame } = render(
    <WelcomeBanner recent={["alpha", "beta", "gamma", "delta"]} />,
  );
  const frame = lastFrame() ?? "";
  expect(frame).toContain("alpha");
  expect(frame).toContain("beta");
  expect(frame).toContain("gamma");
  expect(frame).not.toContain("delta");
});
