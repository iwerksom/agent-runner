/**
 * Purpose: GET /api/agents. The agent grid's only data source: every agent in the
 * registry with its badges, argument specs, 7-day spend, last run, and whether
 * the console may trigger it.
 *
 * Unregistered and orphaned agents are included on purpose. Hiding them would
 * hide exactly the reconciliation problems the registry exists to surface; they
 * come back with `runnable: false` and a reason instead.
 */

import { errorResponse, fail, ok } from "@/lib/http";
import { agentsQuerySchema, searchParamsRecord } from "@/lib/params";
import { loadAgentSummaries } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const parsedQuery = agentsQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsedQuery.success) {
		return fail("Invalid agent query", 400, parsedQuery.error.flatten(), "invalid_query");
	}

	try {
		const agents = await loadAgentSummaries({ repoSlug: parsedQuery.data.repo });
		return ok({ agents });
	} catch (err) {
		return errorResponse(err);
	}
}
