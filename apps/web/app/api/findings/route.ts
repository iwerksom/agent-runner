/**
 * Purpose: GET /api/findings lists the findings agents have reported, optionally
 * narrowed to one repo and one state (open, filed, closed).
 */

import { errorResponse, fail, ok } from "@/lib/http";
import { findingsQuerySchema, searchParamsRecord } from "@/lib/params";
import { loadFindings } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const parsed = findingsQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsed.success) {
		return fail("Invalid findings query", 400, parsed.error.flatten(), "invalid_query");
	}
	try {
		const findings = await loadFindings({
			...(parsed.data.repoSlug === undefined ? {} : { repoSlug: parsed.data.repoSlug }),
			...(parsed.data.state === undefined ? {} : { state: parsed.data.state }),
		});
		return ok({ findings });
	} catch (err) {
		return errorResponse(err);
	}
}
