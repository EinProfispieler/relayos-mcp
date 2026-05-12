import { appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AuditEvent, AuditEventKind } from "./schema.js";
import type { StorageLayout } from "./storage.js";

export interface AuditWriter {
  append(
    handoffId: string,
    event: AuditEventKind,
    detail?: Record<string, unknown>,
  ): Promise<AuditEvent>;
  readByHandoffId(handoffId: string): Promise<AuditEvent[]>;
  readAll(): Promise<AuditEvent[]>;
}

export function createAuditWriter(layout: StorageLayout): AuditWriter {
  return {
    async append(handoffId, event, detail = {}) {
      const entry: AuditEvent = {
        ts: new Date().toISOString(),
        handoff_id: handoffId,
        event,
        detail,
      };
      const line = JSON.stringify(entry) + "\n";
      await appendFile(layout.auditPath, line, "utf8");
      return entry;
    },

    async readByHandoffId(handoffId) {
      const all = await this.readAll();
      return all.filter((e) => e.handoff_id === handoffId);
    },

    async readAll() {
      if (!existsSync(layout.auditPath)) return [];
      const raw = await readFile(layout.auditPath, "utf8");
      const events: AuditEvent[] = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          events.push(JSON.parse(trimmed) as AuditEvent);
        } catch {
          // skip corrupt line; do not fail the read
        }
      }
      return events;
    },
  };
}
