/**
 * Purpose: client provider boundary for the console. Holds only HeroUIProvider,
 * wired to the App Router so HeroUI links and menu items navigate through
 * Next instead of doing a full page load. No app state lives here: Arnold's
 * pages fetch on the server, and the few interactive screens own their own
 * state.
 */

"use client";

import { HeroUIProvider } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
	const router = useRouter();

	return (
		<HeroUIProvider navigate={(path: string) => router.push(path)}>{children}</HeroUIProvider>
	);
}
