/**
 * Purpose: POST /api/registry/sync. Reconciles the manifest overlays in
 * registry/<repo> against the target repo's .claude directory, which is what
 * moves agents between active, unregistered, and orphaned.
 *
 * The result is passed through untouched under `sync`: it is core's reconciliation
 * report, and reshaping it here would mean two definitions of what a sync found.
 */

import { syncRegistry } from "@arnold/core";
import { errorResponse, fail, ok } from "@/lib/http";
import { readJsonBody, registrySyncBodySchema } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const parsedBody = registrySyncBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid sync request", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		const sync = await syncRegistry(parsedBody.data.repoSlug);
		return ok({ sync });
	} catch (err) {
		return errorResponse(err);
	}
}
