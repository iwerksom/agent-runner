/**
 * Purpose: pure display formatters shared by server and client components.
 * Durations, cost, token counts, shas and byte sizes are rendered in several
 * places and must be identical everywhere, because operators compare a run's
 * header against its row in the runs table.
 *
 * Locale-independent on purpose: a run costing $0.42 must not become "0,42" in
 * one place and "0.42" in another between server render and hydration.
 */

/** "1.4s", "2m 05s", "1h 12m". Undefined duration renders as an em dash. */
export function formatDuration(durationMs: number | undefined): string {
	if (durationMs === undefined || Number.isNaN(durationMs)) return "—";
	if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;

	const totalSeconds = Math.floor(durationMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
	return `${(durationMs / 1000).toFixed(1)}s`;
}

/** Sub-cent runs are common, so cost keeps 3 decimals below $1. */
export function formatCostUsd(costUsd: number | undefined): string {
	if (costUsd === undefined || Number.isNaN(costUsd)) return "$0.00";
	if (costUsd > 0 && costUsd < 1) return `$${costUsd.toFixed(3)}`;
	return `$${costUsd.toFixed(2)}`;
}

export function formatTokens(tokens: number | undefined): string {
	if (tokens === undefined || Number.isNaN(tokens)) return "0";
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

export function formatBytes(sizeBytes: number | undefined): string {
	if (sizeBytes === undefined || Number.isNaN(sizeBytes)) return "—";
	if (sizeBytes < 1024) return `${sizeBytes} B`;
	if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Notary convention: base commits are shown at 7 characters, like git does. */
export function shortSha(sha: string | undefined): string | undefined {
	if (!sha) return undefined;
	return sha.slice(0, 7);
}

/** Stable, locale-free absolute timestamp for tooltips and receipt lines. */
export function formatAbsolute(iso: string | undefined): string {
	if (!iso) return "—";
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return iso;
	return parsed.toISOString().replace("T", " ").replace(".000Z", "Z");
}

/** YYYY-MM-DD in UTC. Used to bucket runs into days for the cost sparkline. */
export function utcDayKey(iso: string | Date): string {
	const date = typeof iso === "string" ? new Date(iso) : iso;
	if (Number.isNaN(date.getTime())) return "";
	return date.toISOString().slice(0, 10);
}

/** Titles a kebab-case code for display without losing its exact spelling. */
export function humanizeCode(code: string): string {
	return code.replace(/[-_]/g, " ");
}

/** JSON for a transcript panel: pretty when it is an object, verbatim otherwise. */
export function stringifyPayload(payload: unknown): string {
	if (payload === undefined) return "";
	if (typeof payload === "string") return payload;
	try {
		return JSON.stringify(payload, undefined, 2);
	} catch {
		return String(payload);
	}
}
