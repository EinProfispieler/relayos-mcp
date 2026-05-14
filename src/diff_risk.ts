import { DESTRUCTIVE_HARD, RELEASE_PATTERNS } from "./policy.js";

export type DiffRiskSeverity = "allow" | "warn" | "block";
export type DiffRiskFindingSeverity = Exclude<DiffRiskSeverity, "allow">;

export type DiffRiskFindingCode =
  | "secret_config_path"
  | "ci_deploy_path"
  | "dependency_manifest"
  | "auth_security_path"
  | "large_deletion"
  | "risky_command_in_diff";

export interface DiffRiskFinding {
  code: DiffRiskFindingCode;
  severity: DiffRiskFindingSeverity;
  message: string;
  path?: string;
  evidence?: string;
}

export interface DiffRiskInput {
  statusLines: string[];
  diffText: string;
  untracked: string[];
}

export interface DiffRiskDecision {
  decision: DiffRiskSeverity;
  findings: DiffRiskFinding[];
  files: string[];
  summary: string;
}

interface ParsedStatus {
  code: string;
  path: string;
  raw: string;
}

const LARGE_DELETION_THRESHOLD = 200;

const DEPENDENCY_MANIFEST_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "cargo.toml",
  "cargo.lock",
  "pyproject.toml",
  "pipfile",
  "pipfile.lock",
  "gemfile",
  "gemfile.lock",
  "go.mod",
  "go.sum",
]);

const AUTH_KEYWORDS = new Set([
  "auth",
  "oauth",
  "session",
  "sessions",
  "permission",
  "permissions",
  "acl",
  "security",
  "crypto",
  "password",
  "passwords",
  "payment",
  "payments",
  "billing",
  "stripe",
  "migration",
  "migrations",
]);

const PIPE_TO_SHELL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcurl\b[^\n]*\|\s*sh\b/i, label: "curl | sh" },
  { pattern: /\bwget\b[^\n]*\|\s*sh\b/i, label: "wget | sh" },
  { pattern: /\bcurl\b[^\n]*\|\s*bash\b/i, label: "curl | bash" },
  { pattern: /\bwget\b[^\n]*\|\s*bash\b/i, label: "wget | bash" },
];

const RISKY_COMMAND_PATTERNS = [
  ...DESTRUCTIVE_HARD,
  ...RELEASE_PATTERNS,
  ...PIPE_TO_SHELL_PATTERNS,
];

function unquoteGitPath(path: string): string {
  if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
    return path.slice(1, -1);
  }
  return path;
}

function parseStatusLine(line: string): ParsedStatus | null {
  if (line.length < 3) return null;
  const code = line.slice(0, 2);
  const rest = line.slice(3);
  const renameIdx = rest.indexOf(" -> ");
  const pathPart = renameIdx >= 0 ? rest.slice(renameIdx + 4) : rest;
  const path = unquoteGitPath(pathPart);
  if (path.length === 0) return null;
  return { code, path, raw: line };
}

function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? path : path.slice(idx + 1);
}

function segmentsOf(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function pathTokens(path: string): string[] {
  return path
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());
}

function matchSecretConfigPath(path: string): string | null {
  const basename = basenameOf(path);
  const lc = basename.toLowerCase();
  if (lc === ".env" || /^\.env(\.[A-Za-z0-9_-]+)+$/i.test(basename)) {
    return ".env";
  }
  if (segmentsOf(path).some((s) => s.toLowerCase() === "secrets")) return "secrets/";
  if (lc === "id_rsa") return "id_rsa";
  if (lc === "id_ed25519") return "id_ed25519";
  if (lc === ".netrc") return ".netrc";
  if (/^credentials(?:[._-]|$)/i.test(basename)) return "credentials*";
  if (/\.pem$/i.test(basename)) return "*.pem";
  if (/\.key$/i.test(basename)) return "*.key";
  if (/token/i.test(basename) && !/token(?:ize|izer|ization)/i.test(basename)) {
    return "*token*";
  }
  return null;
}

function matchCiDeployPath(path: string): string | null {
  if (path.toLowerCase().startsWith(".github/workflows/")) return ".github/workflows/**";
  const basename = basenameOf(path);
  const lc = basename.toLowerCase();
  if (lc === "dockerfile" || /^dockerfile\./i.test(basename)) {
    return "Dockerfile";
  }
  if (/^docker-compose.*\.ya?ml$/i.test(basename)) return "docker-compose*";
  if (segmentsOf(path).some((s) => s.toLowerCase() === "deploy")) return "deploy/";
  if (/\.deploy\.sh$/i.test(basename)) return "*.deploy.sh";
  if (lc === "makefile" && !path.includes("/")) return "Makefile";
  return null;
}

function matchDependencyManifest(path: string): string | null {
  const basename = basenameOf(path);
  if (DEPENDENCY_MANIFEST_BASENAMES.has(basename.toLowerCase())) return basename;
  if (/^requirements.*\.txt$/i.test(basename)) return basename;
  return null;
}

function matchAuthSecurityPath(path: string): string | null {
  for (const tok of pathTokens(path)) {
    if (AUTH_KEYWORDS.has(tok)) return tok;
  }
  if (/\.sql$/i.test(basenameOf(path))) return "*.sql";
  return null;
}

function countDeletedDiffLines(diffText: string): number {
  if (diffText.length === 0) return 0;
  let count = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("---")) continue;
    if (line.startsWith("-")) count++;
  }
  return count;
}

function findRiskyAdditions(diffText: string): Array<{ line: string; label: string }> {
  if (diffText.length === 0) return [];
  const hits: Array<{ line: string; label: string }> = [];
  const seen = new Set<string>();
  for (const rawLine of diffText.split("\n")) {
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) continue;
    const content = rawLine.slice(1);
    for (const { pattern, label } of RISKY_COMMAND_PATTERNS) {
      if (pattern.test(content) && !seen.has(label)) {
        seen.add(label);
        hits.push({ line: content.trim(), label });
        break;
      }
    }
  }
  return hits;
}

function candidatePaths(parsed: ParsedStatus[], untracked: string[]): string[] {
  const set = new Set<string>();
  for (const entry of parsed) set.add(entry.path);
  for (const u of untracked) set.add(u);
  return Array.from(set);
}

function rollup(findings: DiffRiskFinding[]): DiffRiskSeverity {
  if (findings.some((f) => f.severity === "block")) return "block";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "allow";
}

function summarize(decision: DiffRiskSeverity, findings: DiffRiskFinding[]): string {
  if (findings.length === 0) return "working tree is clean against HEAD.";
  const blockCount = findings.filter((f) => f.severity === "block").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const verb =
    decision === "block"
      ? "Investigate before commit."
      : "Review before commit.";
  return `${findings.length} finding${findings.length === 1 ? "" : "s"} (${blockCount} block, ${warnCount} warn). ${verb}`;
}

export function evaluateDiffRisk(input: DiffRiskInput): DiffRiskDecision {
  const parsed = input.statusLines
    .map(parseStatusLine)
    .filter((p): p is ParsedStatus => p !== null);
  const files = parsed.map((p) => p.raw);
  const paths = candidatePaths(parsed, input.untracked);

  const findings: DiffRiskFinding[] = [];

  for (const path of paths) {
    const secret = matchSecretConfigPath(path);
    if (secret) {
      findings.push({
        code: "secret_config_path",
        severity: "block",
        message: `path matches secret/config pattern \`${secret}\` (${path})`,
        path,
        evidence: secret,
      });
    }
  }

  for (const path of paths) {
    const ci = matchCiDeployPath(path);
    if (ci) {
      findings.push({
        code: "ci_deploy_path",
        severity: "warn",
        message: `CI/deploy path modified: ${path} (matches \`${ci}\`)`,
        path,
        evidence: ci,
      });
    }
  }

  for (const path of paths) {
    const dep = matchDependencyManifest(path);
    if (dep) {
      findings.push({
        code: "dependency_manifest",
        severity: "warn",
        message: `dependency manifest modified: ${path}`,
        path,
        evidence: dep,
      });
    }
  }

  for (const path of paths) {
    const auth = matchAuthSecurityPath(path);
    if (auth) {
      findings.push({
        code: "auth_security_path",
        severity: "warn",
        message: `auth/security path: ${path} (segment matches \`${auth}\`)`,
        path,
        evidence: auth,
      });
    }
  }

  const deletedLineCount = countDeletedDiffLines(input.diffText);
  const deletedFiles = parsed.filter((p) => p.code.includes("D")).map((p) => p.path);
  if (deletedLineCount >= LARGE_DELETION_THRESHOLD || deletedFiles.length > 0) {
    const fileNote =
      deletedFiles.length > 0
        ? `${deletedFiles.length} file${deletedFiles.length === 1 ? "" : "s"} deleted`
        : null;
    const lineNote =
      deletedLineCount >= LARGE_DELETION_THRESHOLD
        ? `${deletedLineCount} lines removed`
        : null;
    const parts = [lineNote, fileNote].filter((s): s is string => s !== null);
    findings.push({
      code: "large_deletion",
      severity: "warn",
      message: `large deletion: ${parts.join(", ")}`,
      evidence: String(deletedLineCount),
    });
  }

  const riskyHits = findRiskyAdditions(input.diffText);
  for (const hit of riskyHits) {
    findings.push({
      code: "risky_command_in_diff",
      severity: "warn",
      message: `added diff line contains risky command \`${hit.label}\``,
      evidence: hit.label,
    });
  }

  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const ordered = [...blocks, ...warns];

  const decision = rollup(findings);
  return {
    decision,
    findings: ordered,
    files,
    summary: summarize(decision, ordered),
  };
}

export function formatDiffRisk(decision: DiffRiskDecision): string {
  const lines: string[] = [];
  lines.push(`DECISION: ${decision.decision.toUpperCase()}`);
  if (decision.findings.length === 0) {
    lines.push("REASONS: (none)");
  } else {
    lines.push("REASONS:");
    for (const f of decision.findings) {
      lines.push(`- ${f.code}: ${f.message}`);
    }
  }
  if (decision.files.length === 0) {
    lines.push("FILES CHECKED: (none)");
  } else {
    lines.push("FILES CHECKED:");
    for (const file of decision.files) {
      lines.push(`  ${file}`);
    }
  }
  lines.push(`SUMMARY: ${decision.summary}`);
  return `${lines.join("\n")}\n`;
}
