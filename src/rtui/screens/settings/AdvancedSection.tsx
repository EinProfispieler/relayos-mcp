import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { colors } from "../../theme/colors.js";
import type { SettingsDraft, PoolEntry } from "./types.js";
import {
  cycle,
  apiBaseOptionsForProvider,
  apiBaseLabel,
  ensureModelInList,
} from "./providerHelpers.js";

interface Props {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  pool: PoolEntry[];
  setPool: React.Dispatch<React.SetStateAction<PoolEntry[]>>;
  orderIds: string[];
  setOrderIds: React.Dispatch<React.SetStateAction<string[]>>;
  message: string;
  setMessage: (msg: string) => void;
  isActive: boolean;
}

const ADVANCED_FIELDS = ["api_base", "provider_order", "timeout_ms"] as const;
type AdvancedField = (typeof ADVANCED_FIELDS)[number];

export function AdvancedSection({
  draft,
  setDraft,
  pool,
  orderIds,
  setOrderIds,
  isActive,
}: Props) {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<AdvancedField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderCursor, setOrderCursor] = useState(0);
  const [apiBaseOptions] = useState<string[]>(
    ensureModelInList(apiBaseOptionsForProvider(draft.provider), draft.api_base),
  );

  const currentField = ADVANCED_FIELDS[cursor] as AdvancedField;

  const orderedLabels = orderIds.map((id) => {
    const p = id === "p1"
      ? { name: draft.provider, model: draft.model }
      : pool.find((x) => x.id === id) ?? { name: "unknown", model: "unknown" };
    return `${id}:${p.name}/${p.model}`;
  });

  useInput((input, key) => {
    if (!isActive) return;

    if (ordering) {
      if (key.escape || input.toLowerCase() === "q" || key.return) {
        setOrdering(false);
        return;
      }
      if (key.upArrow) {
        setOrderCursor((n) => Math.max(0, n - 1));
        return;
      }
      if (key.downArrow) {
        setOrderCursor((n) => Math.min(orderIds.length - 1, n + 1));
        return;
      }
      if (key.leftArrow && orderCursor > 0) {
        setOrderIds((prev) => {
          const next = prev.slice();
          const t = next[orderCursor - 1];
          next[orderCursor - 1] = next[orderCursor] ?? "";
          next[orderCursor] = t ?? "";
          return next;
        });
        setOrderCursor((n) => n - 1);
        return;
      }
      if (key.rightArrow && orderCursor < orderIds.length - 1) {
        setOrderIds((prev) => {
          const next = prev.slice();
          const t = next[orderCursor + 1];
          next[orderCursor + 1] = next[orderCursor] ?? "";
          next[orderCursor] = t ?? "";
          return next;
        });
        setOrderCursor((n) => n + 1);
      }
      return;
    }

    if (editing) {
      if (key.escape) {
        setEditing(null);
        setEditValue("");
        return;
      }
      if (key.return) {
        if (editing === "api_base") {
          setDraft((d) => ({ ...d, api_base: editValue.trim() || d.api_base }));
        }
        setEditing(null);
        setEditValue("");
        return;
      }
      if (key.backspace || key.delete) {
        setEditValue((v) => v.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input.length > 0) {
        setEditValue((v) => v + input);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((n) => (n - 1 + ADVANCED_FIELDS.length) % ADVANCED_FIELDS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((n) => (n + 1) % ADVANCED_FIELDS.length);
      return;
    }

    if (key.leftArrow || key.rightArrow) {
      const delta = key.rightArrow ? 1 : -1;
      if (currentField === "api_base" && apiBaseOptions.length > 0) {
        const nextBase = cycle(apiBaseOptions, draft.api_base, delta);
        setDraft((d) => ({ ...d, api_base: nextBase }));
      }
      return;
    }

    if (key.return) {
      if (currentField === "provider_order") {
        setOrdering(true);
        setOrderCursor(0);
        return;
      }
      if (currentField === "api_base") {
        setEditing("api_base");
        setEditValue(draft.api_base);
        return;
      }
    }
  }, { isActive });

  const rows: Array<{ field: AdvancedField; label: string; value: string; hint?: string }> = [
    {
      field: "api_base",
      label: "API Endpoint",
      value: editing === "api_base" ? `${editValue}_` : apiBaseLabel(draft.provider, draft.api_base),
      hint: "← → preset · Enter custom",
    },
    {
      field: "provider_order",
      label: "Provider Order",
      value: orderedLabels.join(" > "),
      hint: "Enter to reorder",
    },
    {
      field: "timeout_ms",
      label: "Timeout (ms)",
      value: "120000",
      hint: "fixed",
    },
  ];

  return (
    <Box flexDirection="column" paddingY={1}>
      {rows.map((row, idx) => {
        const active = idx === cursor;
        const isEditing = editing === row.field;

        return (
          <Box key={row.field} flexDirection="row">
            <Text color={active ? colors.accent : colors.dim}>
              {active ? "❯ " : "  "}
            </Text>
            <Text color={active ? colors.accent : undefined}>
              {row.label.padEnd(16)}
            </Text>
            <Text color={isEditing ? colors.thinking : active ? colors.accent : colors.dim}>
              {"["}
            </Text>
            <Text color={isEditing ? colors.thinking : active ? colors.accent : undefined}>
              {row.value}
            </Text>
            <Text color={isEditing ? colors.thinking : active ? colors.accent : colors.dim}>
              {"]"}
            </Text>
            {row.hint ? (
              <Text color={colors.dim}>{"   " + row.hint}</Text>
            ) : null}
          </Box>
        );
      })}

      {ordering ? (
        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor={colors.thinking} paddingX={1}>
          <Text color={colors.thinking}>Provider order editor (left/right swap, Enter/Esc exit)</Text>
          {orderedLabels.map((x, i) => (
            <Text key={x} color={i === orderCursor ? colors.thinking : undefined}>
              {i === orderCursor ? "❯ " : "  "}
              {x}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
