import { test, expect } from "bun:test";
import { buildEchoReply } from "./echo.js";

test("returns a non-empty reply prefixed with echo:", () => {
  const reply = buildEchoReply("hello world");
  expect(reply).toBe("echo: hello world");
});

test("trims input", () => {
  const reply = buildEchoReply("   spaced   ");
  expect(reply).toBe("echo: spaced");
});

test("handles empty input as placeholder", () => {
  const reply = buildEchoReply("");
  expect(reply).toBe("echo: (empty)");
});
