import type { Envelope } from "./schema.js";

export type PolicySeverity = "allow" | "warn" | "block";

export type PolicyFindingSeverity = Exclude<PolicySeverity, "allow">;

export type PolicyFindingCode =
  | "broad_edit_scope"
  | "destructive_instruction"
  | "release_action"
  | "network_command"
  | "secret_sensitive_path";

export interface PolicyFinding {
  code: PolicyFindingCode;
  severity: PolicyFindingSeverity;
  message: string;
  evidence?: string;
}

export interface PolicyDecision {
  decision: PolicySeverity;
  findings: PolicyFinding[];
}

export const DESTRUCTIVE_HARD: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brm\s+-rf\b/i, label: "rm -rf" },
  { pattern: /\bgit\s+push\b[^\n]*?\s(?:--force\b|-f\b)/i, label: "git push --force" },
  { pattern: /--no-verify\b/i, label: "--no-verify" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, label: "git reset --hard" },
  { pattern: /\bdrop\s+table\b/i, label: "drop table" },
  { pattern: /\bdrop\s+database\b/i, label: "drop database" },
  { pattern: /\btruncate\s+table\b/i, label: "truncate table" },
  { pattern: /\bchmod\s+777\b/i, label: "chmod 777" },
  { pattern: /\bsudo\s+rm\b/i, label: "sudo rm" },
  { pattern: /:\(\)\s*\{/, label: "fork-bomb :(){" },
];

const DESTRUCTIVE_SOFT_KEYWORDS = ["delete", "destroy", "wipe", "purge"] as const;
const SOFT_PATH_HINT =
  /\b(?:table|database|tables|databases|directory|folder|file|files|index|indexes|repo|repository|branch|branches)\b|\/[A-Za-z._-]/;

export const RELEASE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bnpm\s+publish\b/i, label: "npm publish" },
  { pattern: /\bgh\s+release\b/i, label: "gh release" },
  { pattern: /\bgit\s+tag\b/i, label: "git tag" },
  { pattern: /\bgit\s+push\b[^\n]*?\s--tags\b/i, label: "git push --tags" },
  { pattern: /\bcargo\s+publish\b/i, label: "cargo publish" },
  { pattern: /\btwine\s+upload\b/i, label: "twine upload" },
  { pattern: /\bpypi\b/i, label: "pypi" },
  { pattern: /\brelease\s+v\d/i, label: "release v<N>" },
];

const NETWORK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcurl\s+/i, label: "curl" },
  { pattern: /\bwget\s+/i, label: "wget" },
  { pattern: /\bnc\s+-/i, label: "nc" },
  { pattern: /\bnetcat\b/i, label: "netcat" },
  { pattern: /\bssh\s+[A-Za-z0-9_.@-]/i, label: "ssh" },
  { pattern: /\bscp\s+/i, label: "scp" },
  { pattern: /\brsync\s+/i, label: "rsync" },
  { pattern: /\bnmap\b/i, label: "nmap" },
  { pattern: /\bpip\s+install\b/i, label: "pip install" },
  { pattern: /\bnpm\s+install\s+-g\b/i, label: "npm install -g" },
  { pattern: /\bcargo\s+install\b/i, label: "cargo install" },
  { pattern: /\bgem\s+install\b/i, label: "gem install" },
  { pattern: /\bbrew\s+install\b/i, label: "brew install" },
];

export const SECRET_PATH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:^|[\s,;"'`(\/])\.env(?:\.[A-Za-z0-9_-]+)?(?=[\s,;"'`)\/]|$)/i, label: ".env" },
  { pattern: /(?:^|[\s,;"'`(\/])secrets\/[A-Za-z0-9_*.\/-]*/i, label: "secrets/" },
  { pattern: /\bid_rsa\b/i, label: "id_rsa" },
  { pattern: /\bid_ed25519\b/i, label: "id_ed25519" },
  { pattern: /~\/\.aws\b/i, label: "~/.aws" },
  { pattern: /~\/\.ssh\b/i, label: "~/.ssh" },
  { pattern: /(?:^|[\s,;"'`(\/])\.netrc\b/i, label: ".netrc" },
  { pattern: /\b[A-Za-z0-9_-]+\.pem\b/i, label: "*.pem" },
  { pattern: /\b[A-Za-z0-9_-]+\.key\b/i, label: "*.key" },
];

function envelopeText(env: Envelope): string {
  return [env.task_title, env.task_description, env.constraints.join("\n")]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n");
}

function checkBroadEditScope(env: Envelope): PolicyFinding | null {
  const editModes = new Set<Envelope["execution_mode"]>(["patch", "test"]);
  if (!editModes.has(env.execution_mode)) return null;
  if (env.allowed_files.length > 0) return null;
  return {
    code: "broad_edit_scope",
    severity: "warn",
    message: `${env.execution_mode} mode with no allowed_files`,
  };
}

function checkDestructiveInstruction(text: string): PolicyFinding | null {
  for (const { pattern, label } of DESTRUCTIVE_HARD) {
    if (pattern.test(text)) {
      return {
        code: "destructive_instruction",
        severity: "block",
        message: `task references destructive command \`${label}\``,
        evidence: label,
      };
    }
  }
  for (const keyword of DESTRUCTIVE_SOFT_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    if (pattern.test(text) && SOFT_PATH_HINT.test(text)) {
      return {
        code: "destructive_instruction",
        severity: "warn",
        message: `task mentions \`${keyword}\` alongside a path or resource`,
        evidence: keyword,
      };
    }
  }
  return null;
}

function checkReleaseAction(text: string): PolicyFinding | null {
  for (const { pattern, label } of RELEASE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        code: "release_action",
        severity: "warn",
        message: `task mentions release action \`${label}\``,
        evidence: label,
      };
    }
  }
  return null;
}

function checkNetworkCommand(text: string): PolicyFinding | null {
  for (const { pattern, label } of NETWORK_PATTERNS) {
    if (pattern.test(text)) {
      return {
        code: "network_command",
        severity: "warn",
        message: `task mentions network/install command \`${label}\``,
        evidence: label,
      };
    }
  }
  return null;
}

function matchSecretPath(haystack: string): { label: string } | null {
  for (const { pattern, label } of SECRET_PATH_PATTERNS) {
    if (pattern.test(haystack)) return { label };
  }
  return null;
}

function forbidsSecrets(forbidden: string[]): boolean {
  const norm = forbidden.map((f) => f.trim().toLowerCase());
  const coversEnv = norm.some(
    (p) => p === ".env" || p === ".env*" || p === ".env**" || p.startsWith(".env*"),
  );
  const coversSecrets = norm.some(
    (p) => p === "secrets/**" || p === "secrets/*" || p === "secrets/",
  );
  return coversEnv && coversSecrets;
}

function checkSecretSensitivePath(env: Envelope): PolicyFinding | null {
  const allowedHits = env.allowed_files
    .map((p) => matchSecretPath(p))
    .filter((m): m is { label: string } => m !== null);
  const taskHit = matchSecretPath(envelopeText(env));

  const hit = allowedHits[0] ?? taskHit;
  if (!hit) return null;

  const exempt = forbidsSecrets(env.forbidden_files);
  const where = allowedHits.length > 0 ? "allowed_files" : "task";
  return {
    code: "secret_sensitive_path",
    severity: exempt ? "warn" : "block",
    message: `${where} references secret-sensitive path \`${hit.label}\`${exempt ? " (mitigated by forbidden_files)" : ""}`,
    evidence: hit.label,
  };
}

function rollup(findings: PolicyFinding[]): PolicySeverity {
  if (findings.some((f) => f.severity === "block")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "allow";
}

export function evaluatePolicy(envelope: Envelope): PolicyDecision {
  const text = envelopeText(envelope);
  const findings: PolicyFinding[] = [];

  const broad = checkBroadEditScope(envelope);
  if (broad) findings.push(broad);

  const destructive = checkDestructiveInstruction(text);
  if (destructive) findings.push(destructive);

  const release = checkReleaseAction(text);
  if (release) findings.push(release);

  const network = checkNetworkCommand(text);
  if (network) findings.push(network);

  const secret = checkSecretSensitivePath(envelope);
  if (secret) findings.push(secret);

  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const ordered = [...blocks, ...warns];

  return { decision: rollup(findings), findings: ordered };
}

export function formatBannerLines(decision: PolicyDecision): string[] {
  if (decision.decision === "allow") return [];
  const header = `# RelayOS policy: ${decision.decision.toUpperCase()}`;
  const body = decision.findings.map((f) => `# - ${f.code}: ${f.message}`);
  return [header, ...body];
}
