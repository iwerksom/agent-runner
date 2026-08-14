/**
 * Purpose: GET /api/runs/[runId]. The full run record behind the run page:
 * summary fields, the agent it ran, the transcript in seq order, collected
 * artifacts, child runs, and the notarised workspace path and base ref.
 */

import { errorResponse, fail, ok } from "@/lib/http";
import { loadRunDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
	const { runId } = await params;

	try {
		const run = await loadRunDetail(runId);
		if (!run) return fail(`No run with id ${runId}`, 404, undefined, "run_not_found");
		return ok({ run });
	} catch (err) {
		return errorResponse(err);
	}
}
