/**
 * Purpose: typed access to the JSON-as-TEXT columns SQLite forces on us
 * (`Agent.manifest`, `Run.args`, `RunEvent.payload`, ...). Every read and write
 * of those columns goes through here, so when Phase 1 swaps SQLite for Postgres
 * and the columns become real `jsonb`, only this file changes.
 *
 * Call sites never touch JSON.parse directly: a malformed column must degrade to
 * a caller-supplied fallback rather than throw somewhere up the stack, because a
 * single bad row would otherwise take out a whole list page.
 */

/**
 * Parse a JSON-as-TEXT column. Returns `fallback` for null, empty, or malformed
 * content. The cast is unavoidable: SQLite gives us a string and there is no
 * schema to validate against at this layer.
 */
export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
	if (value === null || value === undefined) return fallback;
	const trimmed = value.trim();
	if (trimmed === "") return fallback;
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (parsed === null || parsed === undefined) return fallback;
		return parsed as T;
	} catch {
		// A corrupt column is a data problem, not a control-flow problem. The
		// caller's fallback keeps the surrounding page renderable.
		return fallback;
	}
}

/**
 * Serialise a value for a JSON-as-TEXT column. `undefined` becomes "null" so the
 * column is always valid JSON, which keeps `parseJsonColumn` cheap.
 */
export function stringifyJsonColumn(value: unknown): string {
	try {
		const encoded = JSON.stringify(value ?? null);
		return encoded === undefined ? "null" : encoded;
	} catch {
		// Cyclic or non-serialisable payloads (an SDK message holding a stream
		// handle, say) must not abort a run mid-transcript.
		return JSON.stringify({ unserializable: String(value) });
	}
}
