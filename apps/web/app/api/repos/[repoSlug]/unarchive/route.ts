/**
 * Purpose: POST /api/repos/[repoSlug]/unarchive. Brings a retired repo back.
 *
 * A separate route rather than a PATCH field because un-retiring is not an edit:
 * it changes whether the repo can be a run target, which is the one thing
 * archiving was for.
 */

import { unarchiveRepo } from "@arnold/core";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ repoSlug: string }> },
) {
	const { repoSlug } = await params;

	try {
		const repo = await unarchiveRepo(repoSlug);
		return ok({ repo });
	} catch (err) {
		return errorResponse(err);
	}
}
