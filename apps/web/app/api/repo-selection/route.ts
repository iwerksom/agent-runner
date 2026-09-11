/**
 * Purpose: POST /api/repo-selection. Remembers which repo the operator picked.
 *
 * A sibling of /api/repos, not a child: see the note in repo-probe/route.ts about
 * `[repoSlug]` shadowing and Next's underscore-prefixed private folders.
 *
 * A Route Handler rather than a Server Component write because HTTP cannot set a
 * cookie once streaming has started, so `cookies().set` is only legal here or in
 * a Server Function.
 *
 * The cookie is a display preference, not a permission: it decides what the
 * console shows, never what a run is allowed to touch. Every trigger still names
 * its repo explicitly in the request body, so a stale or forged cookie cannot
 * redirect a run at a repo the operator did not choose. It is therefore readable
 * by script (`httpOnly: false`) and `sameSite: lax`.
 */

import { cookies } from "next/headers";
import { z } from "zod";
import { errorResponse, fail, ok } from "@/lib/http";
import { readJsonBody } from "@/lib/params";
import { REPO_SELECTION_COOKIE, REPO_SELECTION_MAX_AGE_SECONDS } from "@/lib/repoSelection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** `null` clears the selection, which is what "All repos" submits. */
const selectionBodySchema = z.object({ repoSlug: z.string().min(1).nullable() });

export async function POST(request: Request) {
	const parsedBody = selectionBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid selection", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		const cookieStore = await cookies();
		if (parsedBody.data.repoSlug === null) {
			cookieStore.delete(REPO_SELECTION_COOKIE);
			return ok({ repoSlug: null });
		}

		cookieStore.set(REPO_SELECTION_COOKIE, parsedBody.data.repoSlug, {
			path: "/",
			sameSite: "lax",
			httpOnly: false,
			maxAge: REPO_SELECTION_MAX_AGE_SECONDS,
		});
		return ok({ repoSlug: parsedBody.data.repoSlug });
	} catch (err) {
		return errorResponse(err);
	}
}
