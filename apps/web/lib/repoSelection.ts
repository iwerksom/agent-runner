/**
 * Purpose: resolve which repo the console is currently pointed at.
 *
 * Two sources, in priority order:
 *
 *   1. `?repo=<slug>` in the URL. Explicit, linkable, and how the existing
 *      status filter already works, so a repo-scoped view can be pasted into a
 *      message like any other filtered view.
 *   2. The `arnold.repo` cookie. Remembers the last choice so the selection
 *      survives navigating from Agents to Runs and back, which a URL param alone
 *      does not.
 *
 * Neither is trusted. A slug that no longer resolves to an active repo — the
 * repo was archived, deleted, or the cookie predates a reseed — falls back to
 * "all repos" rather than rendering an empty console with no explanation.
 * `staleSelection` carries the discarded slug so the UI can say why.
 *
 * Setting the cookie is a Route Handler's job (see `app/api/repo-selection/route.ts`);
 * Server Components can only read it.
 */

import { cookies } from "next/headers";
import type { RepoDto } from "@/components/types";

export const REPO_SELECTION_COOKIE = "arnold.repo";

/** A year: this is a workspace preference, not a session. */
export const REPO_SELECTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type RepoSelection = {
	/** The selected repo, or undefined when the console is showing every repo. */
	selectedRepo?: RepoDto;
	/** Slug that was asked for but could not be honoured. */
	staleSelection?: string;
};

function firstParam(raw: string | string[] | undefined): string | undefined {
	const candidate = Array.isArray(raw) ? raw[0] : raw;
	return candidate === undefined || candidate === "" ? undefined : candidate;
}

/**
 * `repos` is the caller's already-fetched active repo list, passed in rather than
 * fetched again: every page that needs the selection also renders the list, and
 * two queries for the same rows is the self-request mistake in miniature.
 */
export async function resolveRepoSelection(
	repos: RepoDto[],
	searchParamValue?: string | string[] | undefined,
): Promise<RepoSelection> {
	const fromUrl = firstParam(searchParamValue);
	// "all" is how the switcher clears a remembered choice: without it, an empty
	// param would just fall through to the cookie and the selection would stick.
	if (fromUrl === "all") return {};

	const cookieStore = await cookies();
	const requested = fromUrl ?? cookieStore.get(REPO_SELECTION_COOKIE)?.value;
	if (requested === undefined || requested === "") return {};

	const match = repos.find((repo) => repo.slug === requested);
	return match === undefined ? { staleSelection: requested } : { selectedRepo: match };
}
