/**
 * Purpose: the single-repo endpoints. GET returns what removing it would cost,
 * PATCH edits it, DELETE retires or removes it.
 *
 * DELETE defaults to `mode=archive` deliberately. A repo that has run something
 * owns provenance the Notary recorded, and `Run.repoId` is nullable, so a real
 * delete would quietly detach those runs rather than fail. Core refuses that;
 * this route just makes the safe mode the one you get by forgetting.
 */

import { archiveRepo, deleteRepo, planRepoRemoval, updateRepo } from "@arnold/core";
import { errorResponse, fail, ok } from "@/lib/http";
import {
	readJsonBody,
	removeRepoQuerySchema,
	searchParamsRecord,
	updateRepoBodySchema,
} from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ repoSlug: string }> },
) {
	const { repoSlug } = await params;

	try {
		const removal = await planRepoRemoval(repoSlug);
		return ok({ removal });
	} catch (err) {
		return errorResponse(err);
	}
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ repoSlug: string }> },
) {
	const { repoSlug } = await params;
	const parsedBody = updateRepoBodySchema.safeParse(await readJsonBody(request));
	if (!parsedBody.success) {
		return fail("Invalid repo update", 400, parsedBody.error.flatten(), "invalid_body");
	}

	try {
		const updated = await updateRepo(repoSlug, parsedBody.data);
		return ok({ repo: updated });
	} catch (err) {
		return errorResponse(err);
	}
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ repoSlug: string }> },
) {
	const { repoSlug } = await params;
	const parsedQuery = removeRepoQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsedQuery.success) {
		return fail("Invalid removal mode", 400, parsedQuery.error.flatten(), "invalid_query");
	}

	try {
		if (parsedQuery.data.mode === "archive") {
			const archived = await archiveRepo(repoSlug);
			return ok({ repo: archived, mode: "archive" });
		}
		const deleted = await deleteRepo(repoSlug);
		return ok({ repo: deleted, mode: "delete" });
	} catch (err) {
		return errorResponse(err);
	}
}
