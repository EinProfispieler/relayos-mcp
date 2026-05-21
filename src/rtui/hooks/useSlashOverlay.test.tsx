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

function Probe({
  step,
  trigger,
}: {
  step: number;
  trigger: (api: ReturnType<typeof useSlashOverlay>, step: number) => void;
}) {
  const api = useSlashOverlay();
  const { state } = useRTUI();
  useEffect(() => { trigger(api, step); }, [step]);
  const names = api.filtered.map((c) => c.name).join(",");
  return <Text>{`visible=${state.palette.visible} sel=${state.palette.selectedIndex} names=${names}`}</Text>;
}

test("open() shows full registry and visible=true", async () => {
  const { lastFrame } = render(
    <RTUIProvider runtime={runtime}>
      <Probe step={1} trigger={(api) => api.open()} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=true");
  expect(lastFrame()).toContain("/help");
  expect(lastFrame()).toContain("/exit");
});

test("setQuery filters; move() after filter clamps to filtered length; close() hides palette", async () => {
  const trigger = (api: ReturnType<typeof useSlashOverlay>, step: number) => {
    if (step === 1) {
      api.open();
      api.setQuery("/r");
    } else if (step === 2) {
      api.move(10);
    } else if (step === 3) {
      api.close();
    }
  };
  const { lastFrame, rerender } = render(
    <RTUIProvider runtime={runtime}>
      <Probe step={1} trigger={trigger} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  // /r matches /recent /results /run → 3 items
  expect(lastFrame()).toContain("names=/recent,/results,/run");

  rerender(
    <RTUIProvider runtime={runtime}>
      <Probe step={2} trigger={trigger} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  // move(10) sees the post-filter render's filtered.length=3 → clamped to 2
  expect(lastFrame()).toContain("sel=2");

  rerender(
    <RTUIProvider runtime={runtime}>
      <Probe step={3} trigger={trigger} />
    </RTUIProvider>,
  );
  await new Promise((r) => setTimeout(r, 5));
  expect(lastFrame()).toContain("visible=false");
});
