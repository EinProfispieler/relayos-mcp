import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { colors } from "../../theme/colors.js";
import { detectAvailableProviders } from "../../../setup_detect.js";
import type { DetectedProvider } from "../../../setup_detect.js";
import type { SettingsDraft, PoolEntry } from "./types.js";

interface Props {
  draft: SettingsDraft;
  setDraft: React.Dispatch<React.SetStateAction<SettingsDraft>>;
  pool: PoolEntry[];
  setPool: React.Dispatch<React.SetStateAction<PoolEntry[]>>;
  message: string;
  setMessage: (msg: string) => void;
  onImport: (detected: DetectedProvider) => void;
  isActive: boolean;
}

export function DetectedSection({ isActive, onImport }: Props) {
  const [detected, setDetected] = useState<DetectedProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const hasRunRef = useRef(false);

  const runDetection = () => {
    setLoading(true);
    detectAvailableProviders()
      .then((results) => {
        setDetected(results);
        setCursor(0);
      })
      .catch(() => {
        setDetected([]);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isActive && !hasRunRef.current) {
      hasRunRef.current = true;
      runDetection();
    }
  }, [isActive]);

  // Re-run when isActive flips back to true after a re-detection request
  const [rerunKey, setRerunKey] = useState(0);
  useEffect(() => {
    if (isActive && rerunKey > 0) {
      runDetection();
    }
  }, [rerunKey]);

  useInput((input, key) => {
    if (!isActive) return;

    if (input.toLowerCase() === "r") {
      hasRunRef.current = true;
      setRerunKey((n) => n + 1);
      return;
    }

    if (key.upArrow) {
      setCursor((n) => Math.max(0, n - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((n) => Math.min(detected.length - 1, n + 1));
      return;
    }
    if (key.return) {
      const row = detected[cursor];
      if (row && row.available) {
        onImport(row);
      }
      return;
    }
  }, { isActive });

  const sourceLabel = (d: DetectedProvider): string => {
    if (d.source === "env") return "[env var]";
    if (d.source === "codex_oauth") return "[oauth]";
    return "[cli]";
  };

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={colors.dim}>{"  Press r to re-run detection"}</Text>
      {loading ? (
        <Text color={colors.dim}>{"  Scanning for providers…"}</Text>
      ) : detected.length === 0 ? (
        <Text color={colors.dim}>{"  No providers detected. Press r to scan."}</Text>
      ) : (
        detected.map((d, idx) => {
          const active = idx === cursor;
          const icon = d.available ? "✓" : "✗";
          const iconColor = d.available ? colors.ready : colors.error;
          const src = sourceLabel(d);

          return (
            <Box key={`${d.provider}-${d.source}`} flexDirection="column">
              <Box flexDirection="row">
                <Text color={active ? colors.accent : colors.dim}>
                  {active ? "❯ " : "  "}
                </Text>
                <Text color={iconColor}>{icon}</Text>
                <Text color={active ? colors.accent : undefined}>
                  {"  " + d.label.padEnd(42)}
                </Text>
                <Text color={colors.dim}>{src.padEnd(12)}</Text>
                {d.available ? (
                  <Text color={colors.dim}>{"Enter to import"}</Text>
                ) : null}
              </Box>
              {!d.available && d.error ? (
                <Text color={colors.dim}>{"      " + d.error}</Text>
              ) : null}
              {d.note ? (
                <Text color={colors.dim}>{"      " + d.note}</Text>
              ) : null}
            </Box>
          );
        })
      )}
    </Box>
  );
}
