import { test, expect } from "bun:test";
import { runStdoutTransport } from "./stdoutTransport.js";

test("reads one line of input and echoes via the writer", async () => {
  const lines: string[] = [];
  const writer = (chunk: string) => { lines.push(chunk); };
  await runStdoutTransport({ writer, input: "hello\n" });
  const joined = lines.join("");
  expect(joined).toContain("❯ hello");
  expect(joined).toContain("echo: hello");
});

test("handles empty input gracefully", async () => {
  const lines: string[] = [];
  const writer = (chunk: string) => { lines.push(chunk); };
  await runStdoutTransport({ writer, input: "" });
  expect(lines.join("")).toContain("echo: (empty)");
});
