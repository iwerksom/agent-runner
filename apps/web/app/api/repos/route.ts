/**
 * Purpose: GET /api/repos. Lists every target repository with its registered
 * agent count and lifetime run count, which is what the repo switcher and the
 * dashboard header render.
 */

import { errorResponse, ok } from "@/lib/http";
import { loadRepoDtos } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
	try {
		const repos = await loadRepoDtos();
		return ok({ repos });
	} catch (err) {
		return errorResponse(err);
	}
}
