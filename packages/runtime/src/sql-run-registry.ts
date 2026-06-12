/**
 * SQL-backed workflow-run registry (pointer index) over the generic
 * {@link SqlStorage} interface.
 *
 * Backend-agnostic: runs against Cloudflare DO SQLite (the `FlueRegistry`
 * Durable Object) and `node:sqlite` (the Node `sqlite()` persistence
 * adapter). The Cloudflare target talks to the synchronous {@link RegistryOps}
 * through its private REST router (`cloudflare/registry-router.ts`); Node
 * wires {@link createSqlRunRegistry} directly into the runtime.
 */
import {
	DEFAULT_LIST_LIMIT,
	decodeRunCursor,
	encodeRunCursor,
	type ListRunsOpts,
	type ListRunsResponse,
	MAX_LIST_LIMIT,
	type RecordRunEndInput,
	type RecordRunStartInput,
	type RunPointer,
	type RunRegistry,
} from './runtime/run-registry.ts';
import type { RunStatus } from './runtime/run-store.ts';
import { ensureFlueSchemaVersion } from './schema-version.ts';
import type { SqlStorage } from './sql-storage.ts';

type SqlRow = Record<string, unknown>;

/** Synchronous registry operations, as exposed over the Cloudflare registry DO. */
export interface RegistryOps {
	recordRunStart(input: RecordRunStartInput): void;
	recordRunEnd(input: RecordRunEndInput): void;
	lookupRun(runId: string): RunPointer | null;
	listRuns(opts: ListRunsOpts): ListRunsResponse;
}

export function createRegistryOps(sql: SqlStorage): RegistryOps {
	ensureRegistryTables(sql);
	return new SqlRegistryOps(sql);
}

/** Async {@link RunRegistry} facade over {@link RegistryOps} for in-process SQL backends. */
export function createSqlRunRegistry(sql: SqlStorage): RunRegistry {
	return new SqlRunRegistry(createRegistryOps(sql));
}

class SqlRunRegistry implements RunRegistry {
	constructor(private ops: RegistryOps) {}

	async recordRunStart(input: RecordRunStartInput): Promise<void> {
		this.ops.recordRunStart(input);
	}

	async recordRunEnd(input: RecordRunEndInput): Promise<void> {
		this.ops.recordRunEnd(input);
	}

	async lookupRun(runId: string): Promise<RunPointer | null> {
		return this.ops.lookupRun(runId);
	}

	async listRuns(opts: ListRunsOpts = {}): Promise<ListRunsResponse> {
		return this.ops.listRuns(opts);
	}
}

class SqlRegistryOps implements RegistryOps {
	constructor(private sql: SqlStorage) {}

	recordRunStart(input: RecordRunStartInput): void {
		this.sql.exec(
			`INSERT OR IGNORE INTO flue_registry_runs
			 (run_id, workflow_name, status, started_at, ended_at, duration_ms, is_error)
			 VALUES (?, ?, 'active', ?, NULL, NULL, NULL)`,
			input.runId,
			input.workflowName,
			input.startedAt,
		);
	}

	recordRunEnd(input: RecordRunEndInput): void {
		// Upsert so a terminal write heals a start pointer lost to a transient
		// fault; on conflict the original started_at is preserved.
		this.sql.exec(
			`INSERT INTO flue_registry_runs
			 (run_id, workflow_name, status, started_at, ended_at, duration_ms, is_error)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(run_id) DO UPDATE SET
			   status = excluded.status,
			   ended_at = excluded.ended_at,
			   duration_ms = excluded.duration_ms,
			   is_error = excluded.is_error`,
			input.runId,
			input.workflowName,
			input.isError ? 'errored' : 'completed',
			input.startedAt,
			input.endedAt,
			input.durationMs,
			input.isError ? 1 : 0,
		);
	}

	lookupRun(runId: string): RunPointer | null {
		const row = this.sql
			.exec('SELECT * FROM flue_registry_runs WHERE run_id = ?', runId)
			.toArray()[0];
		return row ? rowToRunPointer(row) : null;
	}

	listRuns(opts: ListRunsOpts): ListRunsResponse {
		const limit = clampLimit(opts.limit);
		const cursor = decodeRunCursor(opts.cursor);
		const wheres: string[] = [];
		const bindings: unknown[] = [];
		if (opts.status) {
			wheres.push('status = ?');
			bindings.push(opts.status);
		}
		if (opts.workflowName) {
			wheres.push('workflow_name = ?');
			bindings.push(opts.workflowName);
		}
		if (cursor) {
			wheres.push('(started_at < ? OR (started_at = ? AND run_id < ?))');
			bindings.push(cursor.startedAt, cursor.startedAt, cursor.runId);
		}
		const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
		const rows = this.sql
			.exec(
				`SELECT * FROM flue_registry_runs ${where}
			 ORDER BY started_at DESC, run_id DESC LIMIT ?`,
				...bindings,
				limit + 1,
			)
			.toArray();
		const hasMore = rows.length > limit;
		const page = (hasMore ? rows.slice(0, limit) : rows).map(rowToRunPointer);
		const last = page.at(-1);
		return { runs: page, nextCursor: hasMore && last ? encodeRunCursor(last) : undefined };
	}
}

function ensureRegistryTables(sql: SqlStorage): void {
	ensureFlueSchemaVersion(sql);
	sql.exec(
		`CREATE TABLE IF NOT EXISTS flue_registry_runs (
		 run_id TEXT PRIMARY KEY,
		 workflow_name TEXT,
		 status TEXT NOT NULL,
		 started_at TEXT NOT NULL,
		 ended_at TEXT,
		 duration_ms INTEGER,
		 is_error INTEGER
		)`,
	);
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_registry_status_started_idx ON flue_registry_runs (status, started_at DESC)',
	);
	sql.exec(
		'CREATE INDEX IF NOT EXISTS flue_registry_workflow_started_idx ON flue_registry_runs (workflow_name, started_at DESC)',
	);
}

function rowToRunPointer(row: SqlRow): RunPointer {
	return {
		runId: String(row.run_id),
		workflowName: String(row.workflow_name),
		status: String(row.status) as RunStatus,
		startedAt: String(row.started_at),
		endedAt: typeof row.ended_at === 'string' ? row.ended_at : undefined,
		durationMs: typeof row.duration_ms === 'number' ? row.duration_ms : undefined,
		isError:
			row.is_error === null || row.is_error === undefined ? undefined : Boolean(row.is_error),
	};
}

function clampLimit(limit: number | undefined): number {
	if (!limit || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIST_LIMIT;
	return Math.min(limit, MAX_LIST_LIMIT);
}
