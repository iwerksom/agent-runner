/**
 * Purpose: root layout. Sets the dark theme on <html> (the console is dark by
 * default, matching example-repo), mounts the client provider boundary and
 * the top nav, and constrains every page to one content column.
 *
 * Server component: nothing here needs interactivity, so the only client code
 * shipped from this file is Providers and Nav.
 */

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	title: "Arnold",
	description:
		"Agent Runner, Notary, Orchestrator, Ledger, Dispatcher. A console for running Claude agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en" className="dark">
			<body className="min-h-screen bg-background text-foreground antialiased">
				<Providers>
					<Nav />
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
