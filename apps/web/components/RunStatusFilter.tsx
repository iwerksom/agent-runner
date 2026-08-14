/**
 * Purpose: the status filter on /runs. Writes the choice to the URL rather than
 * to component state, so the server component re-fetches with ?status= and a
 * filtered view can be linked to or reloaded — an operator watching for failures
 * keeps that URL open.
 */

"use client";

import { Chip } from "@heroui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { RUN_STATUSES, type RunStatus } from "@/components/types";

export function RunStatusFilter({
	runStatusFilterActive,
	runStatusFilterCounts,
}: {
	runStatusFilterActive: RunStatus | undefined;
	/** Counts from the loaded page of runs; a hint, not a total. */
	runStatusFilterCounts?: Partial<Record<RunStatus, number>>;
}) {
	const router = useRouter();
	const searchParams = useSearchParams();

	const select = (status: RunStatus | undefined) => {
		const params = new URLSearchParams(searchParams?.toString() ?? "");
		if (status) params.set("status", status);
		else params.delete("status");
		const query = params.toString();
		router.push(query ? `/runs?${query}` : "/runs");
	};

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{/* Native buttons wrap the chips: the chip carries the styling, the button
			    carries the semantics and the keyboard behaviour. */}
			<button
				type="button"
				onClick={() => select(undefined)}
				aria-pressed={!runStatusFilterActive}
			>
				<Chip
					size="sm"
					variant={runStatusFilterActive === undefined ? "solid" : "bordered"}
					color={runStatusFilterActive === undefined ? "primary" : "default"}
					classNames={{ base: "cursor-pointer", content: "text-[11px]" }}
				>
					all
				</Chip>
			</button>

			{RUN_STATUSES.map((status) => {
				const active = runStatusFilterActive === status;
				const count = runStatusFilterCounts?.[status];
				return (
					<button
						key={status}
						type="button"
						onClick={() => select(status)}
						aria-pressed={active}
					>
						<Chip
							size="sm"
							variant={active ? "solid" : "bordered"}
							color={active ? "primary" : "default"}
							classNames={{ base: "cursor-pointer", content: "text-[11px]" }}
						>
							{status}
							{count !== undefined ? ` ${count}` : ""}
						</Chip>
					</button>
				);
			})}
		</div>
	);
}
