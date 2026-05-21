import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { colors } from "../../theme/colors.js";
import type { SettingsDraft, PoolEntry } from "./types.js";

interface Props {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  pool: PoolEntry[];
  setPool: React.Dispatch<React.SetStateAction<PoolEntry[]>>;
  message: string;
  setMessage: (msg: string) => void;
  isActive: boolean;
}

const AUTH_FIELDS = ["api_key_env", "api_key"] as const;
type AuthField = (typeof AUTH_FIELDS)[number];

export function AuthSection({ draft, setDraft, isActive }: Props) {
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<AuthField | null>(null);
  const [editValue, setEditValue] = useState("");

  const currentField = AUTH_FIELDS[cursor] as AuthField;

  const envVarResolved =
    draft.api_key_env.trim().length > 0 &&
    (process.env[draft.api_key_env.trim()]?.length ?? 0) > 0;

  const maskKey = (val: string): string => {
    if (val.length === 0) return "";
    if (val.length <= 4) return "*".repeat(val.length);
    return "*".repeat(val.length - 4) + val.slice(-4);
  };

  useInput((input, key) => {
    if (!isActive) return;

    if (editing) {
      if (key.escape) {
        setEditing(null);
        setEditValue("");
        return;
      }
      if (key.return) {
        if (editing === "api_key_env") {
          setDraft((d) => ({ ...d, api_key_env: editValue.trim() }));
        }
        if (editing === "api_key") {
          setDraft((d) => ({ ...d, api_key: editValue }));
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
      setCursor((n) => (n - 1 + AUTH_FIELDS.length) % AUTH_FIELDS.length);
      return;
    }
    if (key.downArrow) {
      setCursor((n) => (n + 1) % AUTH_FIELDS.length);
      return;
    }
    if (key.return) {
      setEditing(currentField);
      setEditValue(currentField === "api_key_env" ? draft.api_key_env : draft.api_key);
      return;
    }
  }, { isActive });

  const apiKeyDisplayValue = (): string => {
    if (editing === "api_key") return `${maskKey(editValue)}_`;
    if (draft.api_key.trim().length > 0) return "***set***";
    if (draft.has_saved_encrypted_key) return "saved (encrypted)";
    return "(empty)";
  };

  const apiKeyEnvDisplayValue = (): string => {
    if (editing === "api_key_env") return `${editValue}_`;
    return draft.api_key_env || "(empty)";
  };

  const showApiFields = draft.kind === "api";

  return (
    <Box flexDirection="column" paddingY={1}>
      {!showApiFields ? (
        <Text color={colors.dim}>{"  Auth fields only apply when Kind = api."}</Text>
      ) : null}

      {AUTH_FIELDS.map((field, idx) => {
        const active = idx === cursor;
        const isEditing = editing === field;
        const label = field === "api_key_env"
          ? (draft.provider === "glm" ? "GLM Token Env" : "API Token Env")
          : (draft.provider === "glm" ? "GLM Token Direct" : "API Token Direct");
        const value = field === "api_key_env" ? apiKeyEnvDisplayValue() : apiKeyDisplayValue();

        return (
          <Box key={field} flexDirection="column">
            <Box flexDirection="row">
              <Text color={active ? colors.accent : colors.dim}>
                {active ? "❯ " : "  "}
              </Text>
              <Text color={active ? colors.accent : undefined}>
                {label.padEnd(18)}
              </Text>
              <Text color={isEditing ? colors.thinking : active ? colors.accent : colors.dim}>
                {"["}
              </Text>
              <Text color={isEditing ? colors.thinking : active ? colors.accent : undefined}>
                {value}
              </Text>
              <Text color={isEditing ? colors.thinking : active ? colors.accent : colors.dim}>
                {"]"}
              </Text>
              {active && !isEditing ? (
                <Text color={colors.dim}>{"   Enter to edit"}</Text>
              ) : null}
            </Box>
          </Box>
        );
      })}

      <Box flexDirection="column" marginTop={1}>
        {envVarResolved ? (
          <Text color={colors.ready}>{"  ✓ Env var resolved"}</Text>
        ) : draft.api_key_env.trim().length > 0 ? (
          <Text color={colors.error}>{"  ✗ Env var not set in current process"}</Text>
        ) : null}
        {draft.has_saved_encrypted_key ? (
          <Text color={colors.ready}>{"  ✓ Encrypted key saved in config"}</Text>
        ) : null}
        {showApiFields && !envVarResolved && !draft.has_saved_encrypted_key && draft.api_key.trim().length === 0 ? (
          <Text color={colors.error}>{"  ⚠ Warning: no token configured — API chat will fail"}</Text>
        ) : null}
        {showApiFields ? (
          <Text color={colors.dim}>{"  Use ONE auth method: Token Env or Direct Token."}</Text>
        ) : null}
      </Box>
    </Box>
  );
}
