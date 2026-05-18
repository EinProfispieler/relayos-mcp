import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { decryptConfigSecret } from "../../secret_crypto.js";
import { getProjectConfigSecret } from "../../config_secret.js";
import { loadProjectConfig } from "../../config.js";
import { useRTUI } from "../state/context.js";
import { getRuntimeView } from "../runtime/runtimeInfo.js";
import { colors } from "../theme/colors.js";
import { loadDraft, saveDraft } from "./settings/configIO.js";
import type { SettingsDraft, PoolEntry } from "./settings/types.js";
import type { DetectedProvider } from "../../setup_detect.js";
import { defaultApiBase, defaultModelsForProvider, ensureModelInList } from "./settings/providerHelpers.js";
import { ProviderSection } from "./settings/ProviderSection.js";
import { AuthSection } from "./settings/AuthSection.js";
import { DetectedSection } from "./settings/DetectedSection.js";
import { AdvancedSection } from "./settings/AdvancedSection.js";

interface Props {
  onClose: () => void;
}

const TABS = ["Provider", "Auth", "Detected", "Advanced"] as const;
type TabIndex = 0 | 1 | 2 | 3;

export function SettingsPanel({ onClose }: Props) {
  const { dispatch } = useRTUI();
  const loaded = useMemo(() => loadDraft(process.cwd()), []);

  const [draft, setDraft] = useState<SettingsDraft>(loaded.draft);
  const [pool, setPool] = useState<PoolEntry[]>(loaded.pool);
  const [orderIds, setOrderIds] = useState<string[]>(loaded.orderIds);
  const [activeSection, setActiveSection] = useState<TabIndex>(0);
  const [message, setMessage] = useState<string>("");

  const secretReady = useMemo(() => (getProjectConfigSecret(process.cwd())?.length ?? 0) > 0, []);

  const resolveSavedEncryptedToken = (): string => {
    try {
      const { config } = loadProjectConfig({ cwd: process.cwd() });
      const overseer = config.overseer;
      const primaryId = overseer?.primary_provider;
      const primary =
        Array.isArray(overseer?.providers) && typeof primaryId === "string"
          ? overseer.providers.find((p) => p.id === primaryId)
          : null;
      const enc = primary?.api_key_enc ?? (typeof overseer?.provider === "object" ? overseer.provider.api_key_enc : undefined);
      if (!enc || enc.trim().length === 0) return "";
      const secret = getProjectConfigSecret(process.cwd());
      if (!secret) return "";
      return decryptConfigSecret(enc, secret).trim();
    } catch {
      return "";
    }
  };

  const saveAndRefresh = () => {
    const shouldMarkEncrypted = draft.kind === "api" && draft.api_key.trim().length > 0;
    const saved = saveDraft(process.cwd(), draft, pool, orderIds);
    if (shouldMarkEncrypted) {
      setDraft((d) => ({ ...d, has_saved_encrypted_key: true, api_key: "" }));
    }
    dispatch({ type: "RUNTIME_UPDATED", runtime: getRuntimeView() });
    const apiKeyFromEnv = draft.api_key_env.trim().length > 0 ? (process.env[draft.api_key_env.trim()] ?? "") : "";
    const hasToken =
      draft.api_key.trim().length > 0 ||
      apiKeyFromEnv.trim().length > 0 ||
      resolveSavedEncryptedToken().length > 0;
    if (draft.kind === "api" && !hasToken) {
      setMessage(`Saved: ${saved} (warning: no token in current process, API chat will fail)`);
      return;
    }
    setMessage(`Saved: ${saved}`);
  };

  const handleImport = (detected: DetectedProvider) => {
    setDraft((d) => ({
      ...d,
      provider: detected.provider,
      kind: detected.kind,
      model: detected.model,
      api_base: defaultApiBase(detected.provider),
      api_key_env: detected.api_key_env ?? "",
    }));
    setPool((p) => {
      const existing = p.find((e) => e.name === detected.provider);
      if (existing) return p;
      return [
        ...p,
        {
          id: `p_${detected.provider}`,
          name: detected.provider,
          kind: detected.kind,
          model: detected.model,
          effort: "medium",
          api_base: detected.kind === "api" ? defaultApiBase(detected.provider) : undefined,
          api_key_env: detected.api_key_env,
        },
      ];
    });
    setActiveSection(0);
    setMessage("Imported — review in Provider tab, then Save");
  };

  // Tab-level keyboard: Tab, Shift+Tab, number keys 1-4, Esc, s
  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.tab && key.shift) {
      setActiveSection((s) => ((s - 1 + TABS.length) % TABS.length) as TabIndex);
      return;
    }
    if (key.tab) {
      setActiveSection((s) => ((s + 1) % TABS.length) as TabIndex);
      return;
    }
    if (input === "1") { setActiveSection(0); return; }
    if (input === "2") { setActiveSection(1); return; }
    if (input === "3") { setActiveSection(2); return; }
    if (input === "4") { setActiveSection(3); return; }
    if (input.toLowerCase() === "s") {
      try {
        saveAndRefresh();
      } catch (e) {
        setMessage(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
  });

  const messageColor = message.startsWith("Saved")
    ? colors.ready
    : message.startsWith("Error") || message.startsWith("Save failed")
    ? colors.error
    : colors.dim;

  const sharedProps = {
    draft,
    setDraft,
    pool,
    setPool,
    orderIds,
    setOrderIds,
    message,
    setMessage,
  };

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={colors.accent} paddingX={1} paddingY={0}>
      {/* Tab bar */}
      <Box flexDirection="row" marginBottom={0}>
        {TABS.map((tab, idx) => {
          const active = idx === activeSection;
          return (
            <Box key={tab} marginRight={1}>
              <Text bold={active} color={active ? colors.accent : colors.dim}>
                {"[ "}
                <Text bold={active}>{idx + 1} {tab}</Text>
                {" ]"}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Keyboard legend */}
      <Text dimColor>
        {"↑↓ navigate  ← → change  Enter edit  Tab section  s save  Esc close"}
      </Text>

      {/* Secret status */}
      <Text color={secretReady ? colors.ready : colors.dim}>
        {`Secret: ${secretReady ? "ready" : "auto-generate on first encrypted save"}`}
      </Text>

      {/* Active section */}
      {activeSection === 0 ? (
        <ProviderSection {...sharedProps} isActive={true} />
      ) : null}
      {activeSection === 1 ? (
        <AuthSection {...sharedProps} isActive={true} />
      ) : null}
      {activeSection === 2 ? (
        <DetectedSection {...sharedProps} onImport={handleImport} isActive={true} />
      ) : null}
      {activeSection === 3 ? (
        <AdvancedSection {...sharedProps} isActive={true} />
      ) : null}

      {/* Status strip */}
      <Box minHeight={1} marginTop={1}>
        <Text color={messageColor}>{message || " "}</Text>
      </Box>
    </Box>
  );
}
