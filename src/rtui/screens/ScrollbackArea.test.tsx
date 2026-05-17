import { test, expect } from "bun:test";
import { render } from "ink-testing-library";
import { ScrollbackArea } from "./ScrollbackArea.js";
import type { ScrollbackItem } from "../state/types.js";

test("renders user_input with ❯ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "user_input", text: "hello" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("❯ hello");
});

test("renders assistant_text without prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "assistant_text", text: "world" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("world");
});

test("renders system_note with ✓ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "system_note", text: "done" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✓ done");
});

test("renders error with ✗ prefix", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "error", text: "boom" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toContain("✗ boom");
});

test("renders divider as a horizontal rule line", () => {
  const items: ScrollbackItem[] = [{ id: "1", type: "divider" }];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  expect(lastFrame()).toMatch(/─+/);
});

test("renders multiple items in order", () => {
  const items: ScrollbackItem[] = [
    { id: "1", type: "user_input", text: "first" },
    { id: "2", type: "assistant_text", text: "second" },
  ];
  const { lastFrame } = render(<ScrollbackArea items={items} />);
  const out = lastFrame() ?? "";
  expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
});
