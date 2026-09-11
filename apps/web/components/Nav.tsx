/**
 * Purpose: the slim top bar. Arnold wordmark, the destinations that matter
 * (Agents, Runs, Repos), the repo switcher, and the expansion of the name —
 * Agent Runner, Notary, Orchestrator, Ledger, Dispatcher — kept small, because
 * it explains the five subsystems every screen below is showing.
 *
 * The switcher is here rather than on the agents page because it scopes every
 * screen below it, and a scope you cannot see is a scope you will forget.
 *
 * Client component so the active link can be highlighted from the pathname, and
 * so the switcher can read `?repo=` off the URL.
 *
 * The switcher sits behind a `Suspense` boundary because it calls
 * `useSearchParams`, which is prerender-hostile: without a boundary the client
 * tree up to the nearest one is client-rendered, the server and client trees stop
 * matching, and React Aria's sequential ids drift apart — a hydration mismatch on
 * the Select's `id`/`aria-labelledby`, reported by the dev overlay and silent in
 * production. The fallback is sized to the Select so the bar does not shift.
 */

"use client";

import { Suspense } from "react";
import { Chip } from "@heroui/react";
import { Bot, FolderGit2, ListOrdered } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RepoSwitcher } from "@/components/RepoSwitcher";
import type { RepoDto } from "@/components/types";

/** Same footprint as the Select it stands in for, so the bar does not reflow. */
function RepoSwitcherFallback() {
	return <div className="h-8 w-[13rem] rounded-medium bg-content2" aria-hidden />;
}

const LINKS = [
	{ href: "/", label: "Agents", icon: Bot },
	{ href: "/runs", label: "Runs", icon: ListOrdered },
	{ href: "/repos", label: "Repos", icon: FolderGit2 },
] as const;

export function Nav({
	navRepos,
	navSelectedRepoSlug,
}: {
	navRepos: RepoDto[];
	navSelectedRepoSlug?: string;
}) {
	const pathname = usePathname() ?? "/";

	return (
		<header className="sticky top-0 z-40 border-b border-divider bg-background/80 backdrop-blur">
			<nav className="mx-auto flex h-14 w-full max-w-main-wrapper items-center gap-6 px-4 md:px-6">
				<Link href="/" className="flex items-baseline gap-2">
					<span className="text-lg font-semibold tracking-tight text-foreground">
						Arnold
					</span>
					<span className="hidden text-[10px] uppercase tracking-[0.18em] text-default-500 lg:inline">
						Agent Runner · Notary · Orchestrator · Ledger · Dispatcher
					</span>
				</Link>

				<div className="ml-auto flex items-center gap-2">
					<Suspense fallback={<RepoSwitcherFallback />}>
						<RepoSwitcher
							repoSwitcherRepos={navRepos}
							{...(navSelectedRepoSlug === undefined
								? {}
								: { repoSwitcherSelectedSlug: navSelectedRepoSlug })}
						/>
					</Suspense>

					<div className="flex items-center gap-1">
						{LINKS.map((link) => {
							// "/" must not light up for every nested route, so the root is
							// matched exactly while /runs matches its whole subtree.
							const active =
								link.href === "/"
									? pathname === "/" || pathname.startsWith("/agents")
									: pathname.startsWith(link.href);
							const Icon = link.icon;
							return (
								<Link
									key={link.href}
									href={link.href}
									className={`flex items-center gap-1.5 rounded-medium px-3 py-1.5 text-sm transition-colors ${
										active
											? "bg-content2 font-medium text-foreground"
											: "text-default-500 hover:bg-content2 hover:text-foreground"
									}`}
								>
									<Icon className="h-4 w-4" />
									{link.label}
								</Link>
							);
						})}
					</div>
					<Chip
						size="sm"
						variant="bordered"
						classNames={{ base: "ml-2 hidden md:flex", content: "text-[10px]" }}
					>
						phase 0
					</Chip>
				</div>
			</nav>
		</header>
	);
}
