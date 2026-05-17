export type CommandKind = "local" | "cli" | "disabled";

export type LocalHandlerName = "help" | "exit";

export interface SlashCommand {
  name: string;
  description: string;
  kind: CommandKind;
  argv?: readonly string[];
  localHandler?: LocalHandlerName;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/help",     description: "Show available commands",    kind: "local",    localHandler: "help" },
  { name: "/status",   description: "Overseer runtime status",    kind: "cli",      argv: ["overseer", "status"] },
  { name: "/recent",   description: "Recent activity",            kind: "cli",      argv: ["overseer", "recent"] },
  { name: "/next",     description: "Next recommended action",    kind: "cli",      argv: ["overseer", "next"] },
  { name: "/results",  description: "Completed handoff results",  kind: "cli",      argv: ["overseer", "handoff-results"] },
  { name: "/settings", description: "Open settings wizard",       kind: "cli",      argv: ["settings"] },
  { name: "/exit",     description: "Quit RTUI",                  kind: "local",    localHandler: "exit" },
  { name: "/approve",  description: "Approve handoff (coming soon)", kind: "disabled" },
  { name: "/run",      description: "Execute handoff (coming soon)", kind: "disabled" },
];

export function filterCommands(query: string): readonly SlashCommand[] {
  const trimmed = query.startsWith("/") ? query.slice(1) : query;
  const needle = trimmed.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(needle));
}

export function isSelectable(cmd: SlashCommand): boolean {
  return cmd.kind !== "disabled";
}
