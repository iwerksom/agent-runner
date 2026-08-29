/**
 * Purpose: reconcile one repo's registry against its .claude directory from the
 * repo header. This is the only way an `unregistered` prompt file or an
 * `orphaned` manifest shows up in the grid, so it sits next to the agents it
 * changes rather than on a settings screen.
 */

"use client";

import { Button } from "@heroui/react";
import { RefreshCw } from "lucide-react";
import { useRegistrySync } from "@/hooks/useRegistrySync";

export function RegistrySyncButton({
	registrySyncButtonRepoSlug,
}: {
	registrySyncButtonRepoSlug: string;
}) {
	const { registrySyncPending, registrySyncError, registrySyncSummary, registrySyncSubmit } =
		useRegistrySync(registrySyncButtonRepoSlug);

	return (
		<div className="flex flex-wrap items-center gap-2">
			{registrySyncSummary ? (
				<span className="font-mono text-[11px] text-default-500">
					{registrySyncSummary}
				</span>
			) : undefined}
			{registrySyncError ? (
				<span className="font-mono text-[11px] text-danger">{registrySyncError}</span>
			) : undefined}
			<Button
				size="sm"
				variant="flat"
				isLoading={registrySyncPending}
				startContent={
					registrySyncPending ? undefined : <RefreshCw className="h-3.5 w-3.5" />
				}
				onPress={() => void registrySyncSubmit()}
			>
				Sync registry
			</Button>
		</div>
	);
}
