import { test, expect } from "bun:test";
import { render as inkRender, Text } from "ink";
import { render } from "ink-testing-library";
import { EventEmitter } from "node:events";
import { RTUIProvider, useRTUI } from "./context.js";
import type { RuntimeView } from "./types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

function Probe() {
  const { state, dispatch } = useRTUI();
  return <Text>{`status=${state.status} model=${state.runtime.model}`}</Text>;
}

test("provider exposes initial state via useRTUI", () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Probe />
    </RTUIProvider>,
  );
  expect(lastFrame()).toContain("status=idle");
  expect(lastFrame()).toContain("model=stub");
});

// ink-testing-library swallows synchronous render errors; use inkRender directly
// so we can await the exit promise which rejects with the thrown error.
test("useRTUI outside provider throws", async () => {
  class FakeStdout extends EventEmitter {
    columns = 100;
    isTTY = false as const;
    write = (_data: string) => true;
  }
  const stdout = new FakeStdout() as NodeJS.WriteStream & { fd: 1 };
  const instance = inkRender(<Probe />, {
    stdout,
    stdin: process.stdin,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await expect(instance.waitUntilExit()).rejects.toThrow(/RTUIProvider/);
});
