import { test, expect } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { useEffect } from "react";
import { RTUIProvider, useRTUI } from "../state/context.js";
import { useSlashOverlay } from "./useSlashOverlay.js";
import type { RuntimeView } from "../state/types.js";

const runtime: RuntimeView = {
  projectDir: "test",
  branch: "main",
  model: "stub",
  effort: "medium",
  isGitRepo: true,
};

function Probe({ trigger }: { trigger: (api: ReturnType<typeof useSlashOverlay>) => void }) {
  const api = useSlashOverlay();
  const { state } = useRTUI();
  useEffect(() => { trigger(api); }, []);
  const names = api.filtered.map((c) => c.name).join(",");
  return <Text>{`visible=${state.palette.visible} sel=${state.palette.selectedIndex} names=${names}`}</Text>;
}

test("open() shows full registry and visible=true", async () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => api.open()} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=true");
  expect(lastFrame()).toContain("/help");
  expect(lastFrame()).toContain("/exit");
});

test("setQuery filters and move() clamps", async () => {
  const { lastFrame, rerender } = render(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => { api.open(); api.setQuery("/r"); api.move(10); }} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  // /r matches /recent /results /run → 3 items, last index 2
  expect(lastFrame()).toContain("names=/recent,/results,/run");
  expect(lastFrame()).toContain("sel=2");
  rerender(
    <RTUIProvider runtime={runtime}>
      <Probe trigger={(api) => { api.open(); api.setQuery("/r"); api.move(10); api.close(); }} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=false");
});
