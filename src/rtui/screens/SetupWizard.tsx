import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { detectAvailableProviders, type DetectedProvider } from "../../setup_detect.js";
import { saveDraft } from "./settings/configIO.js";
import { defaultApiBase } from "./settings/providerHelpers.js";
import type { SettingsDraft, PoolEntry } from "./settings/types.js";
import { useRTUI } from "../state/context.js";
import { getRuntimeView } from "../runtime/runtimeInfo.js";
import { colors } from "../theme/colors.js";

type WizardStep =
  | "detecting"
  | "choose"
  | "manual"
  | "confirm"
  | "done";

interface SetupWizardProps {
  onClose: () => void;
  cwd: string;
  onOpenSettings?: () => void;
}

function maskApiKey(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return "*".repeat(value.length - 4) + value.slice(-4);
}

export function SetupWizard({ onClose, cwd, onOpenSettings: _onOpenSettings }: SetupWizardProps) {
  const { dispatch } = useRTUI();
  const [step, setStep] = useState<WizardStep>("detecting");
  const [detected, setDetected] = useState<DetectedProvider[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<DetectedProvider | null>(null);
  const [message, setMessage] = useState("");

  // manual step state
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [apiKeyError, setApiKeyError] = useState("");

  // detecting step
  useEffect(() => {
    if (step !== "detecting") return;
    const startTime = Date.now();
    void detectAvailableProviders().then((all) => {
      const available = all.filter((p) => p.available);
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, 500 - elapsed);
      setTimeout(() => {
        setDetected(available);
        if (available.length > 0) {
          setStep("choose");
        } else {
          setStep("manual");
        }
      }, delay);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // done step auto-close
  useEffect(() => {
    if (step !== "done") return;
    const timer = setTimeout(() => {
      onClose();
    }, 1000);
    return () => clearTimeout(timer);
  }, [step, onClose]);

  const totalChoices = detected.length + 1; // +1 for "Manual setup →"

  const doSaveProvider = (provider: DetectedProvider) => {
    try {
      const draft: SettingsDraft = {
        provider: provider.provider,
        kind: provider.kind,
        model: provider.model,
        effort: "medium",
        api_base: defaultApiBase(provider.provider),
        api_key_env: provider.api_key_env ?? "",
        api_key: "",
        has_saved_encrypted_key: false,
      };
      const primaryPoolEntry: PoolEntry = {
        id: "p1",
        name: provider.provider,
        kind: provider.kind,
        model: provider.model,
        effort: "medium",
        api_base: provider.kind === "api" ? defaultApiBase(provider.provider) : undefined,
        api_key_env: provider.kind === "api" ? (provider.api_key_env ?? "") : undefined,
      };
      saveDraft(cwd, draft, [primaryPoolEntry], ["p1"]);
      dispatch({ type: "RUNTIME_UPDATED", runtime: getRuntimeView() });
      setStep("done");
    } catch (e) {
      setMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doSaveManualKey = (apiKey: string) => {
    try {
      const draft: SettingsDraft = {
        provider: "claude",
        kind: "api",
        model: "claude-sonnet-4-6",
        effort: "medium",
        api_base: defaultApiBase("claude"),
        api_key_env: "ANTHROPIC_API_KEY",
        api_key: apiKey,
        has_saved_encrypted_key: false,
      };
      const primaryPoolEntry: PoolEntry = {
        id: "p1",
        name: "claude",
        kind: "api",
        model: "claude-sonnet-4-6",
        effort: "medium",
        api_base: defaultApiBase("claude"),
        api_key_env: "ANTHROPIC_API_KEY",
      };
      saveDraft(cwd, draft, [primaryPoolEntry], ["p1"]);
      dispatch({ type: "RUNTIME_UPDATED", runtime: getRuntimeView() });
      setStep("done");
    } catch (e) {
      setMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useInput(
    (input, key) => {
      if (step === "detecting") return;

      if (step === "done") {
        if (key.return || key.escape) onClose();
        return;
      }

      if (step === "manual") {
        if (key.escape) {
          onClose();
          return;
        }
        if (key.return) {
          if (apiKeyValue.trim().length === 0 || !apiKeyValue.trim().toLowerCase().startsWith("sk-")) {
            setApiKeyError("Key must start with sk-");
            return;
          }
          setApiKeyError("");
          doSaveManualKey(apiKeyValue.trim());
          return;
        }
        if (key.backspace || key.delete) {
          setApiKeyValue((v) => v.slice(0, -1));
          setApiKeyError("");
          return;
        }
        if (!key.ctrl && !key.meta && input.length > 0) {
          setApiKeyValue((v) => v + input);
          setApiKeyError("");
        }
        return;
      }

      if (step === "confirm") {
        if (key.escape) {
          setStep("choose");
          return;
        }
        if (key.return) {
          if (selectedProvider) doSaveProvider(selectedProvider);
          return;
        }
        return;
      }

      if (step === "choose") {
        if (key.escape) {
          onClose();
          return;
        }
        if (key.upArrow) {
          setSelectedIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (key.downArrow) {
          setSelectedIndex((i) => Math.min(totalChoices - 1, i + 1));
          return;
        }
        if (key.return) {
          if (selectedIndex === detected.length) {
            // "Manual setup →"
            setStep("manual");
          } else {
            const provider = detected[selectedIndex];
            if (provider) {
              setSelectedProvider(provider);
              setStep("confirm");
            }
          }
          return;
        }
      }
    },
    { isActive: step !== "detecting" },
  );

  const providerLogo = (p: "claude" | "codex") => (p === "claude" ? "◆" : "▸");

  const renderDetecting = () => (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>RelayOS Setup</Text>
      <Text> </Text>
      <Text>  Scanning for providers…</Text>
    </Box>
  );

  const renderChoose = () => (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>RelayOS Setup</Text>
      <Text> </Text>
      <Text>  Choose a provider to configure:</Text>
      <Text> </Text>
      {detected.map((p, idx) => {
        const active = idx === selectedIndex;
        const logo = providerLogo(p.provider);
        return (
          <Text key={`${p.provider}-${p.source}`} color={active ? colors.accent : undefined}>
            {active ? "❯" : " "}  {idx + 1}  {logo} {p.label.padEnd(40)} {p.note ?? ""}
          </Text>
        );
      })}
      <Text color={selectedIndex === detected.length ? colors.accent : undefined}>
        {selectedIndex === detected.length ? "❯" : " "}  {detected.length + 1}  Manual setup →
      </Text>
      <Text> </Text>
      <Text dimColor>  ↑↓ navigate   Enter select   Esc close</Text>
      {message ? <Text color={colors.error}>{message}</Text> : null}
    </Box>
  );

  const renderManual = () => {
    const masked = maskApiKey(apiKeyValue);
    return (
      <Box flexDirection="column">
        <Text color={colors.accent} bold>RelayOS Setup</Text>
        <Text> </Text>
        <Text>  No providers auto-detected.</Text>
        <Text> </Text>
        <Text>  Enter your Anthropic API key to get started:</Text>
        <Text>  (it starts with sk-ant-…)</Text>
        <Text> </Text>
        <Text>  {">"} [{masked || " "}{apiKeyValue.length > 0 ? "" : "_"}]</Text>
        <Text> </Text>
        {apiKeyError ? <Text color={colors.error}>  {apiKeyError}</Text> : null}
        <Text dimColor>  Press Enter to save · Esc to skip</Text>
        {message ? <Text color={colors.error}>{message}</Text> : null}
      </Box>
    );
  };

  const renderConfirm = () => {
    const p = selectedProvider;
    if (!p) return null;
    return (
      <Box flexDirection="column">
        <Text color={colors.accent} bold>RelayOS Setup</Text>
        <Text> </Text>
        <Text>  Ready to save:</Text>
        <Text> </Text>
        <Text>  {"provider:".padEnd(12)} {p.provider}</Text>
        <Text>  {"kind:".padEnd(12)} {p.kind}</Text>
        <Text>  {"model:".padEnd(12)} {p.model}</Text>
        {p.command ? <Text>  {"command:".padEnd(12)} {p.command}</Text> : null}
        {p.api_key_env ? <Text>  {"api_key_env:".padEnd(12)} {p.api_key_env}</Text> : null}
        <Text> </Text>
        <Text dimColor>  Press Enter to save, Esc to go back.</Text>
        {message ? <Text color={colors.error}>{message}</Text> : null}
      </Box>
    );
  };

  const renderDone = () => (
    <Box flexDirection="column">
      <Text color={colors.accent} bold>RelayOS Setup</Text>
      <Text> </Text>
      <Text color={colors.ready}>  ✓ Saved. You're ready.</Text>
      <Text> </Text>
      <Text dimColor>  Enter close</Text>
    </Box>
  );

  const content = (() => {
    if (step === "detecting") return renderDetecting();
    if (step === "choose") return renderChoose();
    if (step === "manual") return renderManual();
    if (step === "confirm") return renderConfirm();
    if (step === "done") return renderDone();
    return null;
  })();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.accent}
      padding={1}
    >
      {content}
    </Box>
  );
}
