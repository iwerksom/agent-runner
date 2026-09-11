/**
 * Purpose: GET /api/repos lists every target repository with its registered
 * agent count and lifetime run count, which is what the repo switcher and the
 * repos page render. POST /api/repos onboards a new one.
 *
 * Creation validates nothing itself. Slug shape, checkout existence and
 * uniqueness all belong to `createRepo` in @arnold/core, so the console and
 * `pnpm seed` cannot disagree about what a valid repo is.
 */

import { createRepo } from "@arnold/core";
import { errorResponse, fail, ok } from "@/lib/http";
import {
	createRepoBodySchema,
	readJsonBody,
	reposQuerySchema,
	searchParamsRecord,
} from "@/lib/params";
import { loadRepoDtos } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const parsedQuery = reposQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsedQuery.success) {
		return fail("Invalid repo query", 400, parsedQuery.error.flatten(), "invalid_query");
	}

	try {
		const repos = await loadRepoDtos({ includeArchived: parsedQuery.data.includeArchived });
		return ok({ repos });
	} catch (err) {
		return errorResponse(err);
	}
}

export async function POST(request: Request) {
	const parsedBody = createRepoBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid repo", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		const created = await createRepo(parsedBody.data);
		return ok({ repo: created }, { status: 201 });
	} catch (err) {
		return errorResponse(err);
	}
}
