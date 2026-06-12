/**
 * Persisted-store schema versioning.
 *
 * Every persisted Flue store durably records the schema/format version it was
 * created with, and refuses to open a store recorded with an unknown or newer
 * version. This is a storage-agnostic obligation of the
 * {@link PersistenceAdapter} contract: the built-in SQL backends implement it
 * with a one-row `flue_meta` key/value table; non-SQL adapters implement the
 * same obligation natively (a key, a meta document, etc.).
 *
 * There is deliberately no migration framework here — just the stamp and the
 * loud check. `PersistenceAdapter.migrate()` is defined as "bring the store to
 * the current version"; when a future version changes a persisted format, the
 * migration logic lands alongside a bump of {@link FLUE_SCHEMA_VERSION}.
 */

import { PersistedSchemaVersionError } from './errors.ts';
import type { SqlStorage } from './sql-storage.ts';

/**
 * Current schema/format version of Flue's built-in persisted stores.
 *
 * Bump this when a persisted format changes incompatibly, together with
 * `migrate()` logic that brings older stores to the new version.
 */
export const FLUE_SCHEMA_VERSION = 1;

/**
 * Throw {@link PersistedSchemaVersionError} unless the stored version matches
 * the current {@link FLUE_SCHEMA_VERSION}.
 *
 * Adapters call this with the version value they recorded at store creation.
 * A version greater than the current one means the store was written by a
 * newer Flue version and must not be read; any other mismatch means the
 * version marker is unrecognized.
 */
export function assertSupportedFlueSchemaVersion(storedVersion: string): void {
	if (storedVersion === String(FLUE_SCHEMA_VERSION)) return;
	throw new PersistedSchemaVersionError({
		storedVersion,
		supportedVersion: FLUE_SCHEMA_VERSION,
	});
}

/**
 * Stamp-or-check the schema version for a SQLite-dialect store.
 *
 * Creates the `flue_meta` key/value table if missing, records the current
 * {@link FLUE_SCHEMA_VERSION} when no version row exists yet, and throws
 * {@link PersistedSchemaVersionError} when the stored version does not match.
 * Called by every table-ensuring path of the built-in SQL stores, so opening
 * any store against an incompatible database fails before any data is read.
 */
export function ensureFlueSchemaVersion(sql: SqlStorage): void {
	sql.exec(
		`CREATE TABLE IF NOT EXISTS flue_meta (
		 key TEXT PRIMARY KEY,
		 value TEXT NOT NULL
		)`,
	);
	const rows = sql.exec(`SELECT value FROM flue_meta WHERE key = 'schema_version'`).toArray();
	const stored = rows[0]?.value;
	if (stored === undefined || stored === null) {
		sql.exec(
			`INSERT OR IGNORE INTO flue_meta (key, value) VALUES ('schema_version', ?)`,
			String(FLUE_SCHEMA_VERSION),
		);
		return;
	}
	assertSupportedFlueSchemaVersion(String(stored));
}
