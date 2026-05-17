// Phase 0 stub — replaced by bridge.routeConversation in Phase 3.
// Keeps the chat loop visibly closed (input → echo → scrollback) before
// any real AI logic is wired in.
export function buildEchoReply(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) return "echo: (empty)";
  return `echo: ${trimmed}`;
}
