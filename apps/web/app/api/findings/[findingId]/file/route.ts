/**
 * Purpose: POST /api/findings/:findingId/file creates the GitHub issue for one
 * reviewed finding. This is the only way a finding reaches a tracker: it runs on
 * the operator's click, writes to the tracker and never to the repo.
 *
 * All the rules (only an open finding, GitHub remote, no double filing) live in
 * `fileFinding` in @arnold/core.
 */

import { fileFinding } from "@arnold/core";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ findingId: string }> }) {
	const { findingId } = await context.params;
	try {
		const finding = await fileFinding(findingId);
		return ok({
			finding: {
				id: finding.id,
				state: finding.state,
				issueNumber: finding.issueNumber,
				issueUrl: finding.issueUrl,
			},
		});
	} catch (err) {
		return errorResponse(err);
	}
}
