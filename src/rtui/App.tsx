import { useApp, useInput } from "ink";
import { RTUIProvider } from "./state/context.js";
import { Shell } from "./Shell.js";
import { getRuntimeView } from "./runtime/runtimeInfo.js";

export function App() {
  const runtime = getRuntimeView();
  return (
    <RTUIProvider runtime={runtime}>
      <GlobalKeys />
      <Shell />
    </RTUIProvider>
  );
}

function GlobalKeys() {
  const { exit } = useApp();
  useInput((_char, key) => {
    if (key.ctrl && _char === "c") exit();
    if (key.ctrl && _char === "d") exit();
  });
  return null;
}
