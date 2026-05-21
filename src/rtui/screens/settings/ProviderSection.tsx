import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { colors } from "../../theme/colors.js";
import type { SettingsDraft, PoolEntry } from "./types.js";
import {
  cycle,
  effortStepsForProvider,
  defaultModelsForProvider,
  ensureModelInList,
  defaultApiBase,
  apiBaseOptionsForProvider,
  EFFORT_STEPS,
} from "./providerHelpers.js";

interface Props {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  pool: PoolEntry[];
  setPool: React.Dispatch<React.SetStateAction<PoolEntry[]>>;
  message: string;
  setMessage: (msg: string) => void;
  isActive: boolean;
}

const PROVIDER_FIELDS = ["provider", "kind", "model", "effort"] as const;
type ProviderField = (typeof PROVIDER_FIELDS)[number];

export function ProviderSection({ draft, setDraft, setPool, setMessage, isActive }: Props) {
  const [cursor, setCursor] = useState(0);
  const [modelOptions, setModelOptions] = useState<string[]>(
    ensureModelInList(defaultModelsForProvider(draft.provider), draft.model),
  );
  const [loadingModels, setLoadingModels] = useState(false);

  const currentField = PROVIDER_FIELDS[cursor] as ProviderField;

  const refreshModels = async () => {
    setLoadingModels(true);
    try {
      const defaults = defaultModelsForProvider(draft.provider);
      setModelOptions(ensureModelInList(defaults, draft.model));
      setMessage(`Model list refreshed for ${draft.provider}.`);
    } finally {
      setLoadingModels(false);
    }
  };

  useInput((input, key) => {
    if (!isActive) return;

    if (key.upArrow) {
      setCursor((n) => (n - 1 + PROVIDER_FIELDS.length) % PROVIDER_FIELDS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((n) => (n + 1) % PROVIDER_FIELDS.length);
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      const delta = key.rightArrow ? 1 : -1;

      if (currentField === "provider") {
        const nextProvider = cycle(["codex", "claude", "glm"] as const, draft.provider, delta);
        const defaults = defaultModelsForProvider(nextProvider);
        const nextModel = defaults[0] ?? draft.model;
        const nextApiBase = defaultApiBase(nextProvider);
        setModelOptions(ensureModelInList(defaults, nextModel));
        setDraft((d) => ({
          ...d,
          provider: nextProvider,
          model: nextModel,
          api_base: nextApiBase,
        }));
        // Keep pool's p1 entry in sync so Advanced tab's provider order never
        // shows a stale / duplicate entry for the same provider name.
        setPool((p) => {
          const existing = p.find((e) => e.id === "p1");
          const newP1: PoolEntry = {
            id: "p1",
            name: nextProvider,
            model: nextModel,
            effort: existing?.effort ?? "medium",
            kind: existing?.kind ?? "subscription_cli",
            api_base: nextApiBase,
            api_key_env: existing?.api_key_env,
          };
          // Remove any secondary entry that already represents the same provider.
          const rest = p.filter((e) => e.id !== "p1" && e.name !== nextProvider);
          return [newP1, ...rest];
        });
      }

      if (currentField === "kind") {
        const nextKind = cycle(["subscription_cli", "api"] as const, draft.kind, delta);
        setDraft((d) => ({
          ...d,
          kind: nextKind,
          ...(nextKind === "subscription_cli" ? { api_key_env: "", api_key: "" } : {}),
        }));
      }

      if (currentField === "model" && modelOptions.length > 0) {
        const nextModel = cycle(modelOptions, draft.model, delta);
        setDraft((d) => ({ ...d, model: nextModel }));
      }

      if (currentField === "effort" && draft.provider !== "glm") {
        const steps = effortStepsForProvider(draft.provider);
        if (steps.length > 0) {
          setDraft((d) => ({ ...d, effort: cycle(steps, d.effort, delta) }));
        }
      }
      return;
    }

    if (key.return && currentField === "model") {
      void refreshModels();
      return;
    }
  }, { isActive });

  const effortSteps = effortStepsForProvider(draft.provider);

  const renderEffortBar = () => {
    if (draft.provider === "glm") return "n/a (glm api)";
    return effortSteps.map((s) => (s === draft.effort ? `[${s}]` : s)).join(" · ");
  };

  const rows: Array<{ field: ProviderField; label: string; value: string; hint?: string }> = [
    { field: "provider", label: "Provider", value: draft.provider, hint: "Arrow keys to cycle" },
    { field: "kind", label: "Kind", value: draft.kind },
    {
      field: "model",
      label: "Model",
      value: `${draft.model}${loadingModels ? " (loading...)" : ""}`,
      hint: "← → or Enter to fetch live list",
    },
    {
      field: "effort",
      label: "Effort",
      value: draft.effort,
      hint: draft.provider !== "glm" ? `← ${renderEffortBar()} →` : undefined,
    },
  ];

  return (
    <Box flexDirection="column" paddingY={1}>
      {rows.map((row, idx) => {
        const active = idx === cursor;
        return (
          <Box key={row.field} flexDirection="row">
            <Text color={active ? colors.accent : colors.dim}>
              {active ? "❯ " : "  "}
            </Text>
            <Text color={active ? colors.accent : undefined}>
              {row.label.padEnd(12)}
            </Text>
            <Text color={active ? colors.accent : colors.dim}>
              {"["}
            </Text>
            <Text color={active ? colors.accent : undefined}>
              {row.value}
            </Text>
            <Text color={active ? colors.accent : colors.dim}>
              {"]"}
            </Text>
            {row.hint ? (
              <Text color={colors.dim}>{"   " + row.hint}</Text>
            ) : null}
          </Box>
        );
      })}
      {draft.provider === "codex" ? (
        <Text color={colors.dim}>{"  Codex effort levels: low, medium, high, xhigh"}</Text>
      ) : null}
      {draft.provider === "claude" ? (
        <Text color={colors.dim}>{"  Claude effort levels: low, medium, high, xhigh, max"}</Text>
      ) : null}
    </Box>
  );
}
