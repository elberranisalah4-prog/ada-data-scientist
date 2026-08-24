import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db";
import type { AgentResult, Finding, StageId, StageStatus } from "@/lib/types";

export type RunRow = {
  id: string;
  filename: string;
  target: string | null;
  status: "running" | "done" | "error";
  task: string | null;
  selected_model: string | null;
  scoring: string | null;
  rows_in: number | null;
  rows_clean: number | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export type StoredRun = RunRow & {
  findings: Finding[];
  stages: { id: StageId; status: StageStatus; intent: string | null; summary: string | null }[];
  result: AgentResult | null;
  report_md: string | null;
};

type DbStage = {
  stage: StageId;
  status: StageStatus;
  intent: string | null;
  summary: string | null;
};

export async function createRun(filename: string, target: string): Promise<string> {
  const id = randomUUID();
  const db = await getPool();
  await db.execute(
    "INSERT INTO runs (id, filename, target, status) VALUES (?, ?, ?, 'running')",
    [id, filename.slice(0, 255), target.slice(0, 128) || null]
  );
  return id;
}

export async function addFinding(runId: string, finding: Finding): Promise<void> {
  const db = await getPool();
  await db.execute(
    "INSERT INTO findings (run_id, stage, kind, title, detail) VALUES (?, ?, ?, ?, ?)",
    [runId, finding.stage, finding.kind, finding.title.slice(0, 512), finding.detail]
  );
}

export async function upsertStage(
  runId: string,
  stage: StageId,
  status: StageStatus,
  extra?: { intent?: string; summary?: string }
): Promise<void> {
  const db = await getPool();
  await db.execute(
    `INSERT INTO stage_logs (run_id, stage, status, intent, summary)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       intent = COALESCE(VALUES(intent), intent),
       summary = COALESCE(VALUES(summary), summary)`,
    [runId, stage, status, extra?.intent ?? null, extra?.summary ?? null]
  );
}

export async function completeRun(runId: string, result: AgentResult): Promise<void> {
  const db = await getPool();
  await db.execute(
    `UPDATE runs SET
       status = 'done',
       task = ?,
       selected_model = ?,
       scoring = ?,
       rows_in = ?,
       rows_clean = ?,
       result_json = ?,
       report_md = ?,
       finished_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      result.meta.task,
      result.meta.selected_model,
      result.meta.scoring,
      result.meta.rows,
      result.meta.rows_clean,
      JSON.stringify(result),
      result.report_md,
      runId,
    ]
  );
}

export async function failRun(runId: string, message: string): Promise<void> {
  const db = await getPool();
  await db.execute(
    `UPDATE runs SET status = 'error', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [message.slice(0, 4000), runId]
  );
}

export async function listRuns(limit = 30): Promise<RunRow[]> {
  const db = await getPool();
  const [rows] = await db.query(
    `SELECT id, filename, target, status, task, selected_model, scoring, rows_in, rows_clean,
            error_message, created_at, finished_at
     FROM runs ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
  return (rows as RunRow[]).map(serializeDates);
}

export async function getRun(id: string): Promise<StoredRun | null> {
  const db = await getPool();
  const [runRows] = await db.query(
    `SELECT id, filename, target, status, task, selected_model, scoring, rows_in, rows_clean,
            error_message, result_json, report_md, created_at, finished_at
     FROM runs WHERE id = ? LIMIT 1`,
    [id]
  );
  const run = (runRows as Array<RunRow & { result_json: string | null; report_md: string | null }>)[0];
  if (!run) return null;

  const [findingRows] = await db.query(
    "SELECT stage, kind, title, detail FROM findings WHERE run_id = ? ORDER BY id ASC",
    [id]
  );
  const [stageRows] = await db.query(
    "SELECT stage, status, intent, summary FROM stage_logs WHERE run_id = ?",
    [id]
  );

  let result: AgentResult | null = null;
  if (run.result_json) {
    try {
      result = JSON.parse(run.result_json) as AgentResult;
    } catch {
      result = null;
    }
  }

  return {
    ...serializeDates(run),
    findings: findingRows as Finding[],
    stages: (stageRows as DbStage[]).map((row) => ({
      id: row.stage,
      status: row.status,
      intent: row.intent,
      summary: row.summary,
    })),
    result,
    report_md: run.report_md,
  };
}

function serializeDates<T extends { created_at: unknown; finished_at: unknown }>(row: T): T & {
  created_at: string;
  finished_at: string | null;
} {
  return {
    ...row,
    created_at: toIso(row.created_at),
    finished_at: row.finished_at ? toIso(row.finished_at) : null,
  };
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
