/**
 * Purpose: POST /api/runs/[runId]/cancel. Asks core to stop a run.
 *
 * Idempotence and the "already terminal" case are core's call, not this route's:
 * cancelRun owns the status transition, and whatever it refuses comes back
 * through errorResponse with the right status.
 */

import { cancelRun } from "@arnold/core";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
	const { runId } = await params;

	try {
		await cancelRun(runId);
		return ok({ ok: true });
	} catch (err) {
		return errorResponse(err);
	}
}
