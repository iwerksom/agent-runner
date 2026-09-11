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
 * The layout is not given search params, so it can only read the cookie half of
 * the selection, and it passes that through unvalidated. `RepoSwitcher` applies
 * the shared rule on the client, where both halves are visible at once —
 * validating here too would be a second copy of that rule, and those two
 * disagreeing is precisely the bug the shared rule exists to close.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { fetchRepos } from "@/components/api";
import { readRememberedRepoSlug } from "@/lib/repoSelection";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	title: "Arnold",
	description:
		"Agent Runner, Notary, Orchestrator, Ledger, Dispatcher. A console for running Claude agents.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
	const [repos, remembered] = await Promise.all([fetchRepos(), readRememberedRepoSlug()]);

	return (
		<html lang="en" className="dark">
			<body className="min-h-screen bg-background text-foreground antialiased">
				<Providers>
					<Nav
						navRepos={repos}
						{...(remembered === undefined ? {} : { navSelectedRepoSlug: remembered })}
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
