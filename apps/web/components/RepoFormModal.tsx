/**
 * Purpose: add or edit a target repository. The form that replaces editing
 * `TARGET_REPO_*` in `.env.local` and re-running `pnpm seed`.
 *
 * The probe is the point of this screen. Pointing Arnold at a path that is not a
 * git checkout does not fail here, it fails minutes later inside a workspace
 * lease with a git error, which is the worst possible place to learn about a
 * typo. So the local path is probed on blur, the result is shown inline, and the
 * detected branch and remote are offered as defaults for the fields below.
 *
 * Slug is immutable after creation. It names the repo's mirror on disk and its
 * spend-ledger scope, so a rename would leave both behind. The field is disabled
 * in edit mode and says why.
 *
 * Prompt values are the per-repo facts the library prompts refer to as
 * `{{variables}}` (tracker project key, timezone, ...). The list of fields is
 * core's catalogue, handed down by the server page, so adding a variable to
 * core adds a field here without touching this file.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
	Button,
	Input,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@heroui/react";
import { CircleCheck, FolderGit2, Info, TriangleAlert } from "lucide-react";
import { useRepoAdmin, type RepoFormValues } from "@/hooks/useRepoAdmin";
import type { CheckoutProbe, PromptVariableFieldDto, RepoDto } from "@/components/types";

const EMPTY: RepoFormValues = {
	slug: "",
	name: "",
	remoteUrl: "",
	localPath: "",
	defaultBranch: "main",
	claudeDir: ".claude",
	promptVariables: {},
};

function valuesFor(repo: RepoDto | undefined): RepoFormValues {
	if (repo === undefined) return EMPTY;
	return {
		slug: repo.slug,
		name: repo.name,
		remoteUrl: repo.remoteUrl,
		localPath: repo.localPath ?? "",
		defaultBranch: repo.defaultBranch,
		claudeDir: repo.claudeDir,
		promptVariables: { ...repo.promptVariables },
	};
}

/** Lowercases and hyphenates a name into a slug candidate, matching core's rule. */
function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);
}

function ProbeResult({ probeResultProbe }: { probeResultProbe: CheckoutProbe }) {
	const usable = probeResultProbe.blockers.length === 0;

	return (
		<div
			className={`flex flex-col gap-1.5 rounded-medium border px-3 py-2 text-[11px] ${
				usable ? "border-default-200 text-default-500" : "border-danger-400 text-danger"
			}`}
		>
			<div className="flex items-center gap-1.5 font-medium">
				{usable ? (
					<CircleCheck className="h-3.5 w-3.5 shrink-0" />
				) : (
					<TriangleAlert className="h-3.5 w-3.5 shrink-0" />
				)}
				<span className="font-mono">{probeResultProbe.probedPath}</span>
			</div>

			{probeResultProbe.blockers.map((blocker) => (
				<p key={blocker}>{blocker}</p>
			))}
			{probeResultProbe.warnings.map((warning) => (
				<p key={warning} className="text-warning-600">
					{warning}
				</p>
			))}

			{usable ? (
				<p className="text-default-400">
					git checkout
					{probeResultProbe.detectedBranch
						? ` on ${probeResultProbe.detectedBranch}`
						: ""}
					{probeResultProbe.claudeDirPresent ? " · prompt directory present" : ""}
				</p>
			) : undefined}
		</div>
	);
}

export function RepoFormModal({
	repoFormModalRepo,
	repoFormModalPromptVariableFields,
	repoFormModalIsOpen,
	repoFormModalOnClose,
}: {
	/** Absent means "add a repo"; present means "edit this one". */
	repoFormModalRepo?: RepoDto;
	repoFormModalPromptVariableFields: PromptVariableFieldDto[];
	repoFormModalIsOpen: boolean;
	repoFormModalOnClose: () => void;
}) {
	const isEdit = repoFormModalRepo !== undefined;
	const [values, setValues] = useState<RepoFormValues>(valuesFor(repoFormModalRepo));
	const [probe, setProbe] = useState<CheckoutProbe | undefined>(undefined);
	// Tracks whether the operator has typed a slug, so auto-fill from the name
	// stops the moment they take over.
	const [slugTouched, setSlugTouched] = useState(isEdit);

	const {
		repoAdminPending,
		repoAdminError,
		repoAdminClearError,
		repoAdminProbe,
		repoAdminCreate,
		repoAdminUpdate,
	} = useRepoAdmin();

	// Reopening the modal for a different repo must not show the previous one's
	// values, and a closed modal keeps its state mounted.
	useEffect(() => {
		if (!repoFormModalIsOpen) return;
		setValues(valuesFor(repoFormModalRepo));
		setProbe(undefined);
		setSlugTouched(repoFormModalRepo !== undefined);
		repoAdminClearError();
	}, [repoFormModalIsOpen, repoFormModalRepo, repoAdminClearError]);

	const setField = useCallback(
		(field: Exclude<keyof RepoFormValues, "promptVariables">, value: string) => {
			setValues((current) => ({ ...current, [field]: value }));
		},
		[],
	);

	const setPromptVariable = useCallback((name: string, value: string) => {
		setValues((current) => ({
			...current,
			promptVariables: { ...current.promptVariables, [name]: value },
		}));
	}, []);

	/**
	 * Probes on blur rather than on every keystroke: a path is only meaningful
	 * once it is finished, and stat-ing a directory per character is noise.
	 */
	const runProbe = useCallback(async () => {
		if (values.localPath.trim() === "") {
			setProbe(undefined);
			return;
		}
		const result = await repoAdminProbe(values.localPath.trim(), values.claudeDir);
		if (result === undefined) return;
		setProbe(result);

		// Offer what the checkout says about itself, without overwriting anything
		// the operator has already filled in.
		setValues((current) => ({
			...current,
			remoteUrl:
				current.remoteUrl === "" && result.detectedRemote !== undefined
					? result.detectedRemote
					: current.remoteUrl,
			defaultBranch:
				(current.defaultBranch === "" || current.defaultBranch === "main") &&
				result.detectedBranch !== undefined
					? result.detectedBranch
					: current.defaultBranch,
		}));
	}, [repoAdminProbe, values.claudeDir, values.localPath]);

	const submit = useCallback(async () => {
		const trimmed: RepoFormValues = {
			slug: values.slug.trim(),
			name: values.name.trim(),
			remoteUrl: values.remoteUrl.trim(),
			localPath: values.localPath.trim(),
			defaultBranch: values.defaultBranch.trim(),
			claudeDir: values.claudeDir.trim(),
			// Every catalogue field is sent, empty ones included: on an edit the
			// set replaces what is stored, and an emptied field is how a value is
			// unset.
			promptVariables: Object.fromEntries(
				repoFormModalPromptVariableFields.map((field) => [
					field.name,
					(values.promptVariables[field.name] ?? "").trim(),
				]),
			),
		};

		const { slug: _slug, ...patch } = trimmed;
		const succeeded = isEdit
			? await repoAdminUpdate(repoFormModalRepo.slug, patch)
			: await repoAdminCreate(trimmed);
		if (succeeded) repoFormModalOnClose();
	}, [
		isEdit,
		repoAdminCreate,
		repoAdminUpdate,
		repoFormModalOnClose,
		repoFormModalPromptVariableFields,
		repoFormModalRepo,
		values,
	]);

	// Mirrors core's required fields. The server validates again and owns the
	// verdict; this only stops an obviously incomplete submit.
	const canSubmit =
		values.slug.trim() !== "" &&
		values.name.trim() !== "" &&
		values.remoteUrl.trim() !== "" &&
		values.defaultBranch.trim() !== "" &&
		values.claudeDir.trim() !== "";

	return (
		<Modal
			isOpen={repoFormModalIsOpen}
			onClose={repoFormModalOnClose}
			size="2xl"
			scrollBehavior="inside"
			backdrop="blur"
			// Same deliberate redundancy as TriggerRunModal: the primary action must
			// not sit below the fold if one HeroUI theme utility goes unscanned.
			classNames={{
				wrapper: "h-dvh items-center",
				base: "my-0 max-h-[85dvh]",
				body: "overflow-y-auto",
			}}
		>
			<ModalContent>
				<ModalHeader className="flex flex-col gap-1">
					<span className="flex items-center gap-2 text-base font-semibold">
						<FolderGit2 className="h-4 w-4 text-default-400" />
						{isEdit ? `Edit ${repoFormModalRepo.name}` : "Add a repository"}
					</span>
					<span className="text-[11px] font-normal text-default-500">
						Arnold mirrors this repo and leases a git worktree per run. Nothing here
						grants an agent any permission: what a run may touch is the manifest&apos;s
						write scope.
					</span>
				</ModalHeader>

				<ModalBody className="gap-4">
					<Input
						size="sm"
						label="Name"
						value={values.name}
						onValueChange={(next) => {
							setField("name", next);
							if (!slugTouched) setField("slug", slugify(next));
						}}
						description="How the repo is labelled in the switcher and the agents grid."
					/>

					<Input
						size="sm"
						label="Slug"
						value={values.slug}
						isDisabled={isEdit}
						onValueChange={(next) => {
							setSlugTouched(true);
							setField("slug", next);
						}}
						classNames={{ input: "font-mono" }}
						description={
							isEdit
								? "Immutable. It names this repo's mirror on disk and its spend records, so renaming would leave both behind."
								: "Lowercase letters, digits and hyphens. Used in URLs and as the name of this repo's mirror on disk."
						}
					/>

					<Input
						size="sm"
						label="Local checkout path"
						value={values.localPath}
						onValueChange={(next) => setField("localPath", next)}
						onBlur={() => void runProbe()}
						classNames={{ input: "font-mono" }}
						placeholder="/home/you/projects/your-repo"
						description="Cloned from as the workspace source, so no network or deploy key is needed. Leave empty to clone from the remote instead."
					/>

					{probe ? <ProbeResult probeResultProbe={probe} /> : undefined}

					<Input
						size="sm"
						label="Remote URL"
						value={values.remoteUrl}
						onValueChange={(next) => setField("remoteUrl", next)}
						classNames={{ input: "font-mono" }}
						description="Recorded on every run for provenance, and the clone source when no local path is set."
					/>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<Input
							size="sm"
							label="Default branch"
							value={values.defaultBranch}
							onValueChange={(next) => setField("defaultBranch", next)}
							classNames={{ input: "font-mono" }}
							description="The base ref a run is notarised against."
						/>
						<Input
							size="sm"
							label="Prompt directory"
							value={values.claudeDir}
							onValueChange={(next) => setField("claudeDir", next)}
							classNames={{ input: "font-mono" }}
							description="Where registry sync looks for commands and subagents."
						/>
					</div>

					<fieldset className="flex flex-col gap-3 border-t border-divider pt-4">
						<legend className="flex flex-col gap-0.5 pr-2">
							<span className="text-sm font-medium">Prompt values</span>
							<span className="text-[11px] text-default-500">
								Facts about this repo that the agent prompts refer to. An agent that
								needs a value you leave empty is refused with a message naming it.
							</span>
						</legend>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							{repoFormModalPromptVariableFields.map((field) => (
								<Input
									key={field.name}
									size="sm"
									label={field.label}
									value={values.promptVariables[field.name] ?? ""}
									onValueChange={(next) => setPromptVariable(field.name, next)}
									placeholder={field.example}
									classNames={{ input: "font-mono" }}
									description={
										field.usedBy.length > 0
											? `${field.description} Used by ${field.usedBy.join(", ")}.`
											: field.description
									}
								/>
							))}
						</div>
					</fieldset>

					<div className="flex items-start gap-2 rounded-medium border border-default-200 px-3 py-2 text-[11px] text-default-500">
						<Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							Every agent in the library is attached to the repos you add, so this
							repo's agents are on the Agents page as soon as you save.
						</span>
					</div>

					{repoAdminError ? (
						<div className="flex items-start gap-2 rounded-medium border border-danger-400 px-3 py-2 text-[11px] text-danger">
							<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>{repoAdminError}</span>
						</div>
					) : undefined}
				</ModalBody>

				<ModalFooter>
					<Button size="sm" variant="light" onPress={repoFormModalOnClose}>
						Cancel
					</Button>
					<Button
						size="sm"
						color="primary"
						isDisabled={!canSubmit}
						isLoading={repoAdminPending}
						onPress={() => void submit()}
					>
						{isEdit ? "Save changes" : "Add repository"}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}
