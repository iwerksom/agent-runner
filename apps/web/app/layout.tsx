/**
 * Purpose: root layout. Sets the dark theme on <html> (the console is dark by
 * default, matching example-repo), mounts the client provider boundary and
 * the top nav, and constrains every page to one content column.
 *
 * Server component. It is async because the nav carries the repo switcher, which
 * needs the active repo list and the remembered selection. That makes the layout
 * a request-time render, which costs nothing here: every page already declares
 * `dynamic = "force-dynamic"`.
 *
 * The layout is not given search params, so it can only resolve the cookie half
 * of the selection. `RepoSwitcher` reconciles `?repo=` on the client, which is
 * the one place both halves are visible.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Nav } from "@/components/Nav";
import { fetchRepos } from "@/components/api";
import { REPO_SELECTION_COOKIE } from "@/lib/repoSelection";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	title: "Arnold",
	description:
		"Agent Runner, Notary, Orchestrator, Ledger, Dispatcher. A console for running Claude agents.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
	const [repos, cookieStore] = await Promise.all([fetchRepos(), cookies()]);

	// A remembered slug that no longer resolves — archived, deleted, or a cookie
	// older than the last reseed — is dropped rather than shown, so the switcher
	// never names a repo the console cannot open.
	const remembered = cookieStore.get(REPO_SELECTION_COOKIE)?.value;
	const selectedSlug = repos.some((repo) => repo.slug === remembered) ? remembered : undefined;

	return (
		<html lang="en" className="dark">
			<body className="min-h-screen bg-background text-foreground antialiased">
				<Providers>
					<Nav
						navRepos={repos}
						{...(selectedSlug === undefined
							? {}
							: { navSelectedRepoSlug: selectedSlug })}
					/>
					<main className="mx-auto w-full max-w-main-wrapper px-4 py-6 md:px-6 md:py-8">
						{children}
					</main>
					<footer className="mx-auto w-full max-w-main-wrapper px-4 pb-8 md:px-6">
						<p className="text-[11px] text-default-400">
							Arnold — Agent Runner, Notary, Orchestrator, Ledger, Dispatcher.
						</p>
					</footer>
				</Providers>
			</body>
		</html>
	);
}
