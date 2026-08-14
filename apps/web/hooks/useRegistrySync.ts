/**
 * Purpose: reconcile one repo's registry against its .claude directory via
 * POST /api/registry/sync, then refresh the page so the agent grid shows the new
 * states. This is how an `unregistered` prompt file or an `orphaned` manifest
 * appears in the console at all, so the button belongs next to the repo header.
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorBody } from "@/components/types";

export function useRegistrySync(registrySyncRepoSlug: string): {
	registrySyncPending: boolean;
	registrySyncError: string | undefined;
	registrySyncSummary: string | undefined;
	registrySyncSubmit: () => Promise<void>;
} {
	const router = useRouter();
	const [registrySyncPending, setRegistrySyncPending] = useState(false);
	const [registrySyncError, setRegistrySyncError] = useState<string | undefined>(undefined);
	const [registrySyncSummary, setRegistrySyncSummary] = useState<string | undefined>(undefined);

	const registrySyncSubmit = useCallback(async () => {
		setRegistrySyncPending(true);
		setRegistrySyncError(undefined);
		setRegistrySyncSummary(undefined);
		try {
			const response = await fetch("/api/registry/sync", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ repoSlug: registrySyncRepoSlug }),
			});
			const body = (await response.json().catch(() => undefined)) as
				{ sync?: Record<string, unknown> } | ApiErrorBody | undefined;

			if (!response.ok) {
				const errorBody = body as ApiErrorBody | undefined;
				setRegistrySyncError(
					errorBody?.error ?? `Sync failed with HTTP ${response.status}.`,
				);
				return;
			}

			// The sync record's shape is the registry's business, so it is summarised
			// rather than parsed: whatever counters it reports are shown as-is.
			const sync = (body as { sync?: Record<string, unknown> } | undefined)?.sync;
			setRegistrySyncSummary(
				sync
					? Object.entries(sync)
							.map(([key, value]) => `${key}: ${String(value)}`)
							.join(" · ")
					: "Registry synced.",
			);
			router.refresh();
		} catch (error) {
			setRegistrySyncError(error instanceof Error ? error.message : "Sync request failed.");
		} finally {
			setRegistrySyncPending(false);
		}
	}, [registrySyncRepoSlug, router]);

	return { registrySyncPending, registrySyncError, registrySyncSummary, registrySyncSubmit };
}
