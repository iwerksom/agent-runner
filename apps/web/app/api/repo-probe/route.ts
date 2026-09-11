/**
 * Purpose: POST /api/repo-probe. Inspects a local checkout without writing
 * anything, so the add-repo form can say "that is not a git checkout" while the
 * operator is still typing rather than at lease time, minutes into a run.
 *
 * A sibling of /api/repos rather than a child of it. Nesting it would put it in
 * the `[repoSlug]` namespace, where a repo slug could shadow it — and the obvious
 * escape, naming the folder `_probe`, silently unroutes it: Next treats an
 * underscore-prefixed folder as a private implementation detail and excludes it
 * and its subfolders from routing. The symptom is a 405 from the dynamic sibling,
 * not a 404.
 */

import { probeCheckout } from "@arnold/core";
import { errorResponse, fail, ok } from "@/lib/http";
import { probeCheckoutBodySchema, readJsonBody } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
	const parsedBody = probeCheckoutBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid probe request", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		const probe = await probeCheckout(parsedBody.data.localPath, parsedBody.data.claudeDir);
		return ok({ probe });
	} catch (err) {
		return errorResponse(err);
	}
}
