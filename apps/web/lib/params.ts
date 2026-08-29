/**
 * Purpose: request parsing for Arnold's API routes. Query strings and bodies are
 * narrowed here so route handlers work with typed values instead of raw
 * `string | null` search params.
 *
 * Scope note: these schemas validate the envelope only. Whether an agent's
 * arguments are complete, well typed, and mapped to real prompt slots is the
 * Dispatcher's job in @arnold/core, and duplicating it here would let the two
 * copies drift.
 */

import { RUN_STATUSES } from "@arnold/core";
import { z } from "zod";

/**
 * Re-exported rather than restated. SQLite stores RunStatus as a String, so the
 * list has to exist at runtime somewhere; core owns it, and a second copy here
 * would silently go stale the first time a status is added.
 */
export const RUN_STATUS_VALUES = RUN_STATUSES;

/**
 * The UI submits cleared filters as empty strings, which would fail `min(1)`.
 * Dropping empties makes "no filter" and "filter absent" the same request.
 */
export function searchParamsRecord(url: string): Record<string, string> {
	const record: Record<string, string> = {};
	for (const [key, value] of new URL(url).searchParams) {
		if (value !== "") record[key] = value;
	}
	return record;
}

export const runsQuerySchema = z.object({
	agentId: z.string().min(1).optional(),
	repoSlug: z.string().min(1).optional(),
	status: z.enum(RUN_STATUS_VALUES).optional(),
	/** Root-only by default so child runs do not clutter the run list. */
	parent: z.enum(["root", "all"]).default("root"),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type RunsQuery = z.infer<typeof runsQuerySchema>;

export const agentsQuerySchema = z.object({
	repo: z.string().min(1).optional(),
});
export type AgentsQuery = z.infer<typeof agentsQuerySchema>;

export const ledgerQuerySchema = z.object({
	days: z.coerce.number().int().min(1).max(365).default(14),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const createRunBodySchema = z.object({
	agentId: z.string().min(1),
	repoSlug: z.string().min(1),
	args: z.record(z.string()).default({}),
});
export type CreateRunBody = z.infer<typeof createRunBodySchema>;

export const registrySyncBodySchema = z.object({
	repoSlug: z.string().min(1),
});
export type RegistrySyncBody = z.infer<typeof registrySyncBodySchema>;

/** Tolerates an absent or non-JSON body, which zod then reports as invalid. */
export async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return undefined;
	}
}
