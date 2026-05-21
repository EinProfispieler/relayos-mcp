import { buildEchoReply } from "./echo.js";

interface Options {
  writer: (chunk: string) => void;
  input: string;
}

// Non-TTY mode: read one full message from stdin, write user line +
// echo reply as plain text. No Ink, no React. Same buildEchoReply
// underneath, so Phase 3's bridge swap covers both code paths.
export async function runStdoutTransport({ writer, input }: Options): Promise<void> {
  const cleaned = input.replace(/\n$/, "");
  writer(`❯ ${cleaned}\n`);
  writer(`${buildEchoReply(cleaned)}\n`);
}

export async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
