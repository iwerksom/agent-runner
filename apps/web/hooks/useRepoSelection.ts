/**
 * Purpose: change which repo the console is pointed at, and make the choice
 * stick.
 *
 * Two writes per selection, on purpose. The URL gets `?repo=<slug>` so the view
 * is linkable and matches how the run status filter already behaves; the cookie
 * gets the same slug so the choice survives navigating to a page that was linked
 * without the param. `lib/repoSelection.ts` reads them back in that order.
 *
 * The cookie write is awaited before navigating. Doing both at once races: the
 * server can render the new page from the old cookie and the selection appears
 * to have been ignored.
 */

"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ALL_REPOS } from "@/lib/repoSelectionRule";

export { ALL_REPOS };

export function useRepoSelection(): {
	repoSelectionPending: boolean;
	repoSelectionError: string | undefined;
	repoSelectionChange: (repoSlug: string) => Promise<void>;
} {
	const router = useRouter();
	const pathname = usePathname() ?? "/";
	const searchParams = useSearchParams();
	const [isNavigating, startTransition] = useTransition();
	const [repoSelectionPending, setRepoSelectionPending] = useState(false);
	const [repoSelectionError, setRepoSelectionError] = useState<string | undefined>(undefined);

	const repoSelectionChange = useCallback(
		async (repoSlug: string) => {
			setRepoSelectionPending(true);
			setRepoSelectionError(undefined);
			try {
				const response = await fetch("/api/repo-selection", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						repoSlug: repoSlug === ALL_REPOS ? null : repoSlug,
					}),
				});
				if (!response.ok) {
					setRepoSelectionError(
						`Could not save the selection (HTTP ${response.status}).`,
					);
					return;
				}

				const next = new URLSearchParams(searchParams?.toString() ?? "");
				next.set("repo", repoSlug);
				const query = next.toString();
				startTransition(() => {
					router.push(query === "" ? pathname : `${pathname}?${query}`);
					// push alone reuses the cached RSC payload for this route, which
					// was rendered for the previous repo.
					router.refresh();
				});
			} catch (error) {
				setRepoSelectionError(
					error instanceof Error ? error.message : "Could not save the selection.",
				);
			} finally {
				setRepoSelectionPending(false);
			}
		},
		[pathname, router, searchParams],
	);

	return {
		repoSelectionPending: repoSelectionPending || isNavigating,
		repoSelectionError,
		repoSelectionChange,
	};
}
