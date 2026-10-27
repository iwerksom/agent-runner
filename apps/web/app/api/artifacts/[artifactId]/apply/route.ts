/**
 * Purpose: GET and POST /api/artifacts/[artifactId]/apply, for a run's
 * `changes.patch` (feature 3.2).
 *
 * GET says whether the patch can be applied to the repo's checkout right now and,
 * if not, why, so the run page can disable the button with a reason. POST applies
 * it. The rules (right branch, clean tree, patch still fits, never a commit) live
 * in core's changes.ts; this route only checks the envelope.
 */

import { applyRunPatch, patchApplyStatus } from "@arnold/core";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ artifactId: string }> },
) {
	const { artifactId } = await params;
	try {
		return ok({ status: await patchApplyStatus(artifactId) });
	} catch (err) {
		return errorResponse(err);
	}
}

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ artifactId: string }> },
) {
	const { artifactId } = await params;
	try {
		return ok({ applied: await applyRunPatch(artifactId) });
	} catch (err) {
		return errorResponse(err);
	}
}
