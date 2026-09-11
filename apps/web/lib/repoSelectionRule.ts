/**
 * Purpose: the one rule that decides which repo the console is scoped to, in a
 * module with no server-only imports so the server pages and the client switcher
 * can both apply it.
 *
 * It exists because they used to disagree. `resolveRepoSelection` treated a
 * `?repo=` slug as authoritative and fell back to "all repos" when it matched
 * nothing; `RepoSwitcher` quietly ignored the same unknown slug and displayed the
 * cookie instead. Open a stale shared link with a valid cookie and the page
 * listed every repo while the switcher named one — the control lying about the
 * thing it exists to report. One function, two callers, no drift.
 *
 * Precedence: an explicit `?repo=` wins over the remembered cookie, and an
 * explicit value that cannot be honoured falls to "all repos" rather than
 * silently reverting to whatever was remembered. A link that names a repo either
 * shows that repo or says why not; it never shows a different one.
 */

/** The sentinel for "every repo", in both the URL and the switcher. */
export const ALL_REPOS = "all";

export const REPO_SELECTION_COOKIE = "arnold.repo";

/** A year: this is a workspace preference, not a session. */
export const REPO_SELECTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type RepoSelectionResolution = {
	/** Slug the console is scoped to, absent when showing every repo. */
	selectedSlug?: string;
	/** A slug that was asked for and could not be honoured, for the UI to explain. */
	staleSelection?: string;
};

/**
 * `activeSlugs` is the set of repos a run could actually be sent to. An archived
 * or deleted repo is not in it, so a selection naming one resolves as stale.
 */
export function resolveRepoSelectionRule(
	activeSlugs: readonly string[],
	urlValue: string | undefined,
	cookieValue: string | undefined,
): RepoSelectionResolution {
	// "all" is how the switcher clears a remembered choice. Without it an empty
	// param would fall through to the cookie and the selection would stick.
	if (urlValue === ALL_REPOS) return {};

	const requested = urlValue ?? cookieValue;
	if (requested === undefined || requested === "") return {};

	return activeSlugs.includes(requested)
		? { selectedSlug: requested }
		: { staleSelection: requested };
}

/**
 * A destination path carrying the current repo scope, for links that cross
 * between scoped screens.
 *
 * Only `repo` travels. The nav moves between Agents, Runs and Repos, and a run
 * status filter or any other page-specific parameter means nothing on the
 * destination — carrying it would apply a filter the operator never asked for
 * there.
 */
export function repoScopedHref(pathname: string, repoValue: string | undefined): string {
	if (repoValue === undefined || repoValue === "") return pathname;
	return `${pathname}?repo=${encodeURIComponent(repoValue)}`;
}

/**
 * The current URL with `repo` set to `value`, every other parameter kept.
 *
 * For in-page controls, where the surrounding filters belong to this screen and
 * must survive. The runs page's "show all repos" link hard-coded
 * `/runs?repo=all` and so silently cleared an active status filter, changing the
 * run set it claimed only to widen — the status control next to it had preserved
 * other parameters all along.
 */
export function withRepoParam(
	pathname: string,
	currentParams: Record<string, string | string[] | undefined>,
	value: string,
): string {
	const next = new URLSearchParams();
	for (const [key, raw] of Object.entries(currentParams)) {
		if (key === "repo" || raw === undefined) continue;
		const single = Array.isArray(raw) ? raw[0] : raw;
		if (single !== undefined && single !== "") next.set(key, single);
	}
	next.set("repo", value);
	return `${pathname}?${next.toString()}`;
}
