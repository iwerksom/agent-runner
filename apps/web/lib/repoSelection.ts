/**
 * Purpose: the server half of resolving which repo the console is pointed at —
 * read the cookie, apply the shared rule, and hand back the repo row.
 *
 * The rule itself lives in `repoSelectionRule.ts`, which has no server-only
 * imports, because `RepoSwitcher` has to apply exactly the same one on the
 * client. This file only adds what a Server Component can do and a client
 * component cannot: read the cookie jar.
 *
 * Two sources, and the precedence is the rule's:
 *
 *   1. `?repo=<slug>` in the URL. Explicit, linkable, and how the existing
 *      status filter already works, so a repo-scoped view can be pasted into a
 *      message like any other filtered view.
 *   2. The `arnold.repo` cookie. Remembers the last choice so the selection
 *      survives navigating from Agents to Runs and back.
 *
 * Neither is trusted. A slug that no longer resolves to an active repo — the
 * repo was archived, deleted, or the cookie predates a reseed — falls back to
 * "all repos" rather than rendering an empty console with no explanation, and
 * `staleSelection` carries the discarded slug so the UI can say why.
 *
 * Setting the cookie is a Route Handler's job (see
 * `app/api/repo-selection/route.ts`); Server Components can only read it.
 */

import { cookies } from "next/headers";
import { REPO_SELECTION_COOKIE, resolveRepoSelectionRule } from "@/lib/repoSelectionRule";
import type { RepoDto } from "@/components/types";

export {
	ALL_REPOS,
	REPO_SELECTION_COOKIE,
	REPO_SELECTION_MAX_AGE_SECONDS,
} from "@/lib/repoSelectionRule";

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

/** The raw remembered slug, unvalidated. The rule decides whether it stands. */
export async function readRememberedRepoSlug(): Promise<string | undefined> {
	const cookieStore = await cookies();
	return cookieStore.get(REPO_SELECTION_COOKIE)?.value;
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
	const resolution = resolveRepoSelectionRule(
		repos.map((repo) => repo.slug),
		firstParam(searchParamValue),
		await readRememberedRepoSlug(),
	);

	if (resolution.staleSelection !== undefined) {
		return { staleSelection: resolution.staleSelection };
	}
	const match = repos.find((repo) => repo.slug === resolution.selectedSlug);
	return match === undefined ? {} : { selectedRepo: match };
}
