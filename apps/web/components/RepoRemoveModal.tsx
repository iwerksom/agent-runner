/**
 * Purpose: retire or delete a repository, having first said what that costs.
 *
 * The plan is fetched before the dialog can act, so the operator reads "12 runs
 * reference this repo" rather than guessing. Two outcomes, and the difference
 * matters:
 *
 *   Archive  keeps every run, artifact and outcome. The repo leaves the switcher
 *            and stops being a run target. Always available, always reversible.
 *   Delete   removes the row. Only offered when nothing references it, because
 *            `Run.repoId` is nullable: deleting a repo with runs would not fail,
 *            it would quietly null out the provenance the Notary recorded.
 *            See DECISIONS #16.
 *
 * Core enforces that rule; this screen exists so the operator is never surprised
 * by it.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
	Button,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	Spinner,
} from "@heroui/react";
import { Archive, Trash2, TriangleAlert } from "lucide-react";
import { useRepoAdmin } from "@/hooks/useRepoAdmin";
import type { RepoDto, RepoRemovalPlan } from "@/components/types";

function CountRow({
	countRowLabel,
	countRowValue,
}: {
	countRowLabel: string;
	countRowValue: number;
}) {
	return (
		<div className="flex items-baseline justify-between gap-3 text-[11px]">
			<span className="text-default-500">{countRowLabel}</span>
			<span className="font-mono text-foreground">{countRowValue}</span>
		</div>
	);
}

export function RepoRemoveModal({
	repoRemoveModalRepo,
	repoRemoveModalIsOpen,
	repoRemoveModalOnClose,
}: {
	repoRemoveModalRepo: RepoDto;
	repoRemoveModalIsOpen: boolean;
	repoRemoveModalOnClose: () => void;
}) {
	const [plan, setPlan] = useState<RepoRemovalPlan | undefined>(undefined);
	const [planLoading, setPlanLoading] = useState(false);
	const {
		repoAdminPending,
		repoAdminError,
		repoAdminClearError,
		repoAdminPlanRemoval,
		repoAdminRemove,
	} = useRepoAdmin();

	useEffect(() => {
		if (!repoRemoveModalIsOpen) return;
		setPlan(undefined);
		repoAdminClearError();
		setPlanLoading(true);
		void repoAdminPlanRemoval(repoRemoveModalRepo.slug)
			.then(setPlan)
			.finally(() => setPlanLoading(false));
	}, [
		repoAdminClearError,
		repoAdminPlanRemoval,
		repoRemoveModalIsOpen,
		repoRemoveModalRepo.slug,
	]);

	const remove = useCallback(
		async (mode: "archive" | "delete") => {
			const succeeded = await repoAdminRemove(repoRemoveModalRepo.slug, mode);
			if (succeeded) repoRemoveModalOnClose();
		},
		[repoAdminRemove, repoRemoveModalOnClose, repoRemoveModalRepo.slug],
	);

	return (
		<Modal
			isOpen={repoRemoveModalIsOpen}
			onClose={repoRemoveModalOnClose}
			size="lg"
			backdrop="blur"
			classNames={{ wrapper: "h-dvh items-center", base: "my-0 max-h-[85dvh]" }}
		>
			<ModalContent>
				<ModalHeader className="flex flex-col gap-1">
					<span className="text-base font-semibold">
						Remove {repoRemoveModalRepo.name}
					</span>
					<code className="font-mono text-[11px] font-normal text-default-400">
						{repoRemoveModalRepo.slug}
					</code>
				</ModalHeader>

				<ModalBody className="gap-4">
					{planLoading ? (
						<div className="flex items-center gap-2 text-[11px] text-default-500">
							<Spinner size="sm" />
							Reading what depends on this repo…
						</div>
					) : undefined}

					{plan ? (
						<>
							<div className="flex flex-col gap-1 rounded-medium border border-default-200 px-3 py-2">
								<CountRow countRowLabel="Runs" countRowValue={plan.runCount} />
								<CountRow
									countRowLabel="Registered agents"
									countRowValue={plan.agentCount}
								/>
								<CountRow
									countRowLabel="Worktrees"
									countRowValue={plan.workspaceCount}
								/>
								<CountRow
									countRowLabel="Currently leased"
									countRowValue={plan.leasedWorkspaceCount}
								/>
							</div>

							<p className="text-[11px] text-default-500">
								<strong className="font-medium text-foreground">Archive</strong>{" "}
								keeps every run and artifact and removes the repo from the switcher.
								It can be undone at any time.
							</p>

							{plan.canDelete ? (
								<p className="text-[11px] text-default-500">
									<strong className="font-medium text-foreground">Delete</strong>{" "}
									removes the row permanently. Nothing references it, so no
									history is lost.
									{plan.workspaceCount > 0
										? plan.workspaceCount === 1
											? " 1 worktree directory stays on disk and must be removed by hand."
											: ` ${plan.workspaceCount} worktree directories stay on disk and must be removed by hand.`
										: ""}
								</p>
							) : (
								<div className="flex items-start gap-2 rounded-medium border border-warning-400 px-3 py-2 text-[11px] text-warning-600">
									<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<div className="flex flex-col gap-1">
										{plan.deleteBlockers.map((blocker) => (
											<span key={blocker}>{blocker}</span>
										))}
									</div>
								</div>
							)}
						</>
					) : undefined}

					{repoAdminError ? (
						<div className="flex items-start gap-2 rounded-medium border border-danger-400 px-3 py-2 text-[11px] text-danger">
							<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>{repoAdminError}</span>
						</div>
					) : undefined}
				</ModalBody>

				<ModalFooter className="flex-wrap">
					<Button size="sm" variant="light" onPress={repoRemoveModalOnClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						color="danger"
						variant="flat"
						isDisabled={plan === undefined || !plan.canDelete || repoAdminPending}
						startContent={<Trash2 className="h-3.5 w-3.5" />}
						onPress={() => void remove("delete")}
					>
						Delete permanently
					</Button>
					<Button
						size="sm"
						color="warning"
						isDisabled={plan === undefined || !plan.canArchive}
						isLoading={repoAdminPending}
						startContent={<Archive className="h-3.5 w-3.5" />}
						onPress={() => void remove("archive")}
					>
						Archive
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}
