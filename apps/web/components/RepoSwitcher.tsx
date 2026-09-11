/**
 * Purpose: the control that answers "which repo am I looking at". Lives in the
 * top bar because the answer scopes every screen below it, and a scope you
 * cannot see is a scope you will forget.
 *
 * A native `<select>`, not HeroUI's. HeroUI's `Select` is a React Aria collection
 * component, and in the nav — which the root layout renders on every request — it
 * hydrated with different generated ids on the server and the client. React
 * reports that as a mismatch and explicitly does not patch it up, so the trigger
 * shipped an `aria-labelledby` pointing at an id that was not in the document.
 * An explicit `id` fixed half of it; the rest is computed inside `useSelect` from
 * the id it generated before the override, so it is not reachable from here.
 *
 * A `<select>` has no such machinery: it is one element, it is keyboard and
 * screen-reader correct for free, and it cannot introspect children, so it also
 * keeps this file clear of the RSC boundary problem in DECISIONS #12. The styling
 * below is the only cost, and a switcher is not where custom listbox behaviour
 * earns its keep.
 *
 * "All repos" is a real option, not an empty state. Arnold is multi-repo from the
 * data model and the agents grid already groups by repo, so seeing everything at
 * once is a view an operator wants, not a selection they forgot to make.
 */

"use client";

import { ChevronDown, FolderGit2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useRepoSelection } from "@/hooks/useRepoSelection";
import { ALL_REPOS, resolveRepoSelectionRule } from "@/lib/repoSelectionRule";
import type { RepoDto } from "@/components/types";

export function RepoSwitcher({
	repoSwitcherRepos,
	/** The raw remembered slug from the layout, which cannot see search params. */
	repoSwitcherSelectedSlug,
}: {
	repoSwitcherRepos: RepoDto[];
	repoSwitcherSelectedSlug?: string;
}) {
	const { repoSelectionPending, repoSelectionError, repoSelectionChange } = useRepoSelection();
	const searchParams = useSearchParams();

	// With nothing registered there is nothing to switch between, and an empty
	// dropdown next to the wordmark reads as a broken control rather than an
	// empty console. The repos page is where that state gets explained.
	if (repoSwitcherRepos.length === 0) return undefined;

	// The same rule the page ran, on the same inputs, so the two cannot disagree.
	// The layout is not given search params, so this is the only place where both
	// the URL and the cookie are visible at once. Applying it here is what stops a
	// stale `?repo=` link listing every repo while the switcher names one.
	const resolution = resolveRepoSelectionRule(
		repoSwitcherRepos.map((repo) => repo.slug),
		searchParams?.get("repo") ?? undefined,
		repoSwitcherSelectedSlug,
	);
	const selectedKey = resolution.selectedSlug ?? ALL_REPOS;

	return (
		<div className="flex items-center gap-2">
			<div className="relative flex items-center">
				<FolderGit2 className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-default-400" />
				<select
					aria-label="Target repository"
					value={selectedKey}
					disabled={repoSelectionPending}
					onChange={(event) => void repoSelectionChange(event.target.value)}
					className="h-8 w-[13rem] cursor-pointer appearance-none rounded-medium bg-content2 pl-8 pr-7 text-[13px] text-foreground outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-wait disabled:opacity-60"
				>
					<option value={ALL_REPOS}>All repos</option>
					{repoSwitcherRepos.map((repo) => (
						<option key={repo.slug} value={repo.slug}>
							{repo.name}
						</option>
					))}
				</select>
				<ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-default-400" />
			</div>

			{repoSelectionError ? (
				<span className="hidden font-mono text-[11px] text-danger lg:inline">
					{repoSelectionError}
				</span>
			) : undefined}
		</div>
	);
}
