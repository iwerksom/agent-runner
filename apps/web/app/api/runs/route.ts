/**
 * Purpose: GET /api/runs (the run list) and POST /api/runs (trigger a run).
 *
 * POST is deliberately thin. Argument validation, budget checks, execution-mode
 * refusal, and workspace leasing all belong to the Dispatcher in @arnold/core; a
 * second copy of those rules here would be the copy that goes stale. This route
 * checks the envelope, records who asked, and translates core's exceptions.
 */

import { dispatchRun } from "@arnold/core";
import { resolveActingUserId } from "@/lib/currentUser";
import { errorResponse, fail, ok } from "@/lib/http";
import {
	createRunBodySchema,
	readJsonBody,
	runsQuerySchema,
	searchParamsRecord,
} from "@/lib/params";
import { loadRunSummaries } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const parsedQuery = runsQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsedQuery.success) {
		return fail("Invalid run query", 400, parsedQuery.error.flatten(), "invalid_query");
	}

	try {
		const runs = await loadRunSummaries(parsedQuery.data);
		return ok({ runs });
	} catch (err) {
		return errorResponse(err);
	}
}

export async function POST(request: Request) {
	const parsedBody = createRunBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid run request", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		// Phase 0 attribution only; see lib/currentUser.ts for the auth swap point.
		const triggeredById = await resolveActingUserId();
		const { runId } = await dispatchRun({
			agentId: parsedBody.data.agentId,
			repoSlug: parsedBody.data.repoSlug,
			args: parsedBody.data.args,
			triggeredById,
		});
		return ok({ runId }, { status: 201 });
	} catch (err) {
		return errorResponse(err);
	}
}
