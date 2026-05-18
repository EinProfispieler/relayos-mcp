export type Provider = "codex" | "claude" | "glm";
export type Kind = "subscription_cli" | "api";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type PoolEntry = {
  id: string;
  name: Provider;
  kind: Kind;
  model: string;
  effort: Effort;
  api_base?: string;
  api_key_env?: string;
};

export type SettingsDraft = {
  provider: Provider;
  kind: Kind;
  model: string;
  effort: Effort;
  api_base: string;
  api_key_env: string;
  api_key: string;
  has_saved_encrypted_key: boolean;
};
