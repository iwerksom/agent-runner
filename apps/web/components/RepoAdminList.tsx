/**
 * Purpose: the repos page body — one row per target repository, with add, edit,
 * sync, archive and delete.
 *
 * Client component because it owns which modal is open and for which repo. The
 * rows themselves are plain markup rather than a HeroUI `Table`: the table
 * builds a React Aria collection, and this list carries per-row buttons and
 * wrapping monospace paths that a cell-based collection makes harder, not easier.
 *
 * An archived repo stays on this page, dimmed, with Restore in place of Edit.
 * It still owns its run history, so hiding it here would leave that history
 * reachable from the runs list but attached to a repo the console pretends does
 * not exist.
 */

"use client";

import { useState } from "react";
import { Button, Chip } from "@heroui/react";
import { Archive, FolderGit2, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { RegistrySyncButton } from "@/components/RegistrySyncButton";
import { RepoFormModal } from "@/components/RepoFormModal";
import { RepoRemoveModal } from "@/components/RepoRemoveModal";
import { useRepoAdmin } from "@/hooks/useRepoAdmin";
import type { RepoDto } from "@/components/types";

function RepoRow({
	repoRowRepo,
	repoRowOnEdit,
	repoRowOnRemove,
}: {
	repoRowRepo: RepoDto;
	repoRowOnEdit: (repo: RepoDto) => void;
	repoRowOnRemove: (repo: RepoDto) => void;
}) {
	const { repoAdminPending, repoAdminRestore } = useRepoAdmin();
	const archived = repoRowRepo.archivedAt !== undefined;

	return (
		<div
			className={`flex flex-col gap-3 rounded-large border border-default-200 bg-content1 p-4 ${
				archived ? "opacity-60" : ""
			}`}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<div className="flex flex-wrap items-baseline gap-2">
						<h2 className="text-sm font-semibold">{repoRowRepo.name}</h2>
						<code className="font-mono text-[11px] text-default-400">
							{repoRowRepo.slug}
						</code>
						<span className="font-mono text-[11px] text-default-400">
							@ {repoRowRepo.defaultBranch}
						</span>
						{archived ? (
							<Chip
								size="sm"
								variant="flat"
								color="warning"
								classNames={{ content: "text-[10px]" }}
							>
								archived
							</Chip>
						) : undefined}
					</div>

					<code className="font-mono text-[11px] break-all text-default-500">
						{repoRowRepo.localPath ?? repoRowRepo.remoteUrl}
					</code>

					<p className="text-[11px] text-default-400">
						{repoRowRepo.agentCount} agent{repoRowRepo.agentCount === 1 ? "" : "s"} ·{" "}
						{repoRowRepo.runCount} run{repoRowRepo.runCount === 1 ? "" : "s"} · prompts
						in <code className="font-mono">{repoRowRepo.claudeDir}</code>
						{repoRowRepo.localPath === undefined ? " · no local checkout" : ""}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{archived ? (
						<Button
							size="sm"
							variant="flat"
							isLoading={repoAdminPending}
							startContent={<RotateCcw className="h-3.5 w-3.5" />}
							onPress={() => void repoAdminRestore(repoRowRepo.slug)}
						>
							Restore
						</Button>
					) : (
						<>
							<RegistrySyncButton registrySyncButtonRepoSlug={repoRowRepo.slug} />
							<Button
								size="sm"
								variant="flat"
								startContent={<Pencil className="h-3.5 w-3.5" />}
								onPress={() => repoRowOnEdit(repoRowRepo)}
							>
								Edit
							</Button>
						</>
					)}
					<Button
						size="sm"
						variant="light"
						color="danger"
						isIconOnly
						aria-label={`Remove ${repoRowRepo.name}`}
						onPress={() => repoRowOnRemove(repoRowRepo)}
					>
						{archived ? (
							<Trash2 className="h-3.5 w-3.5" />
						) : (
							<Archive className="h-3.5 w-3.5" />
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function RepoAdminList({ repoAdminListRepos }: { repoAdminListRepos: RepoDto[] }) {
	// `undefined` repo with the form open means "add"; a repo means "edit".
	const [formOpen, setFormOpen] = useState(false);
	const [editing, setEditing] = useState<RepoDto | undefined>(undefined);
	const [removing, setRemoving] = useState<RepoDto | undefined>(undefined);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex justify-end">
				<Button
					size="sm"
					color="primary"
					startContent={<Plus className="h-3.5 w-3.5" />}
					onPress={() => {
						setEditing(undefined);
						setFormOpen(true);
					}}
				>
					Add repository
				</Button>
			</div>

			{repoAdminListRepos.length === 0 ? (
				<div className="flex flex-col items-center gap-2 rounded-large border border-dashed border-default-300 px-6 py-10 text-center">
					<FolderGit2 className="h-6 w-6 text-default-400" />
					<p className="text-sm font-medium">No repositories registered</p>
					<p className="max-w-md text-[11px] text-default-500">
						Add a local checkout and Arnold will mirror it and lease a worktree per run.
						Its agents appear once a matching{" "}
						<code className="font-mono">registry/&lt;slug&gt;/</code> directory exists
						and you sync.
					</p>
				</div>
			) : (
				repoAdminListRepos.map((repo) => (
					<RepoRow
						key={repo.slug}
						repoRowRepo={repo}
						repoRowOnEdit={(next) => {
							setEditing(next);
							setFormOpen(true);
						}}
						repoRowOnRemove={setRemoving}
					/>
				))
			)}

			<RepoFormModal
				{...(editing === undefined ? {} : { repoFormModalRepo: editing })}
				repoFormModalIsOpen={formOpen}
				repoFormModalOnClose={() => setFormOpen(false)}
			/>

			{removing ? (
				<RepoRemoveModal
					repoRemoveModalRepo={removing}
					repoRemoveModalIsOpen
					repoRemoveModalOnClose={() => setRemoving(undefined)}
				/>
			) : undefined}
		</div>
	);
}
