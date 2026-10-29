/**
 * Purpose: get a `working-tree` run's edits out of the worktree and into the
 * operator's checkout without the agent ever holding a git-write permission
 * (ROADMAP feature 3.2, `onChanges: "patch"`).
 *
 * A run edits a worktree inside Arnold's mirror, which is not the repo's checkout.
 * After the run, Arnold itself, on the host and outside the sandbox, stores the
 * diff as the run artifact `changes.patch`, and applies it to the checkout only
 * when the operator asks and the checkout is exactly where the run started: the
 * run's base branch, a clean tree. It never commits, never switches branches and
 * never touches a dirty tree.
 *
 * The git work is split from the database work so the smoke test can run it
 * against throwaway repos without a Run row.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Artifact } from "@prisma/client";
import { prisma } from "./db.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { artifactRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

/** The store is for reports, not builds; a patch bigger than this is skipped. */
const MAX_PATCH_BYTES = 5 * 1024 * 1024;

export const PATCH_ARTIFACT_PATH = "changes.patch";
export const PATCH_ARTIFACT_KIND = "patch";

async function git(cwd: string, args: string[]): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
			maxBuffer: 64 * 1024 * 1024,
		});
		return stdout.toString();
	} catch (caught: unknown) {
		const stderr = (caught as { stderr?: unknown }).stderr;
		const detail = typeof stderr === "string" && stderr.trim() !== "" ? stderr : String(caught);
		throw new Error(`git ${args.join(" ")} failed: ${detail.trim()}`);
	}
}

/**
 * The worktree's changes against `baseSha`, as a patch `git apply` accepts, or an
 * empty string when the run changed nothing.
 *
 * New files are made visible with intent-to-add first, because a plain diff leaves
 * them out and a review that adds a test file would lose it. Gitignored files stay
 * out, which is what is wanted. External diff drivers and textconv are off so a
 * repo's own attributes cannot run a program on the host.
 */
export async function computeWorktreePatch(
	workspacePath: string,
	baseSha: string,
): Promise<string> {
	await git(workspacePath, ["add", "-N", "--", "."]);
	return git(workspacePath, [
		"-c",
		"core.quotepath=false",
		"diff",
		"--binary",
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		baseSha,
	]);
}

/**
 * Why a patch cannot be applied to `localPath` right now, or undefined when it
 * can. Checked in the order an operator would fix them: the branch, then the tree,
 * then whether the patch still fits.
 */
export async function patchApplyBlocker(
	localPath: string,
	baseRef: string | undefined,
	patchFile: string,
): Promise<string | undefined> {
	try {
		await stat(path.join(localPath, ".git"));
	} catch {
		return `${localPath} is not a git checkout.`;
	}
	if (baseRef === undefined || baseRef === "") {
		return "The run did not record the branch it started from.";
	}
	let current: string;
	try {
		current = (await git(localPath, ["symbolic-ref", "--short", "-q", "HEAD"])).trim();
	} catch {
		return `The checkout is on a detached HEAD; check out ${baseRef} first.`;
	}
	if (current !== baseRef) {
		return `The checkout is on "${current}", but the run started from "${baseRef}". Check out ${baseRef} first.`;
	}
	if ((await git(localPath, ["status", "--porcelain"])).trim() !== "") {
		return "The checkout has uncommitted changes. Commit or stash them first.";
	}
	try {
		await git(localPath, ["apply", "--check", patchFile]);
	} catch (caught: unknown) {
		const firstLine = String(caught).split("\n")[0] ?? "";
		return `The patch no longer applies: ${firstLine.replace(/^Error: /, "")}`;
	}
	return undefined;
}

/** Apply `patchFile` to the checkout's working tree. Stages and commits nothing. */
export async function applyPatchFile(localPath: string, patchFile: string): Promise<void> {
	await git(localPath, ["apply", patchFile]);
}

/** Files named by a patch, from its `diff --git` headers. */
export function patchFiles(patchText: string): string[] {
	const files: string[] = [];
	for (const match of patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
		const file = match[2];
		if (file !== undefined) files.push(file);
	}
	return files;
}

/** A path for a shell, single-quoted, so the command pastes from any directory. */
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Store the run's changes as `changes.patch`. Returns the artifact row, or
 * undefined when the run changed nothing or the patch could not be taken.
 *
 * Never throws: it runs on the way out of a finished run, and a failure here
 * must not turn a completed run into a failed one and lose the transcript.
 */
export async function capturePatch(
	runId: string,
	workspacePath: string,
	baseSha: string,
): Promise<Artifact | undefined> {
	try {
		const patch = await computeWorktreePatch(workspacePath, baseSha);
		if (patch.trim() === "") return undefined;
		const bytes = Buffer.byteLength(patch);
		if (bytes > MAX_PATCH_BYTES) {
			console.warn(
				`[arnold] skipped the patch for run ${runId}: ${bytes} bytes exceeds the ${MAX_PATCH_BYTES} byte limit`,
			);
			return undefined;
		}
		const taken = await prisma.artifact.findFirst({
			where: { runId, path: PATCH_ARTIFACT_PATH },
			select: { id: true },
		});
		if (taken !== null) {
			console.warn(
				`[arnold] run ${runId} already has an artifact at ${PATCH_ARTIFACT_PATH}; its changes were not stored as a patch`,
			);
			return undefined;
		}
		const directory = path.join(artifactRoot(), runId);
		await mkdir(directory, { recursive: true });
		await writeFile(path.join(directory, PATCH_ARTIFACT_PATH), patch);
		return await prisma.artifact.create({
			data: {
				runId,
				kind: PATCH_ARTIFACT_KIND,
				path: PATCH_ARTIFACT_PATH,
				storageKey: `${runId}/${PATCH_ARTIFACT_PATH}`,
				mimeType: "text/x-diff",
				sizeBytes: bytes,
			},
		});
	} catch (caught: unknown) {
		console.warn(`[arnold] could not capture the patch for run ${runId}: ${String(caught)}`);
		return undefined;
	}
}

export type PatchApplyStatus = {
	canApply: boolean;
	/** Why not, when `canApply` is false. */
	reason?: string;
	/** The same apply as a command, with absolute paths, so it works from any directory. */
	command: string;
	appliedAt?: string;
};

async function loadPatchArtifact(artifactId: string) {
	const artifact = await prisma.artifact.findUnique({
		where: { id: artifactId },
		include: { run: { include: { repo: true } } },
	});
	if (artifact === null || artifact.kind !== PATCH_ARTIFACT_KIND) {
		throw new NotFoundError(`No patch artifact with id ${artifactId}`, { artifactId });
	}
	return artifact;
}

/** Whether the patch can be applied to the repo's checkout now, and the command that does it. */
export async function patchApplyStatus(artifactId: string): Promise<PatchApplyStatus> {
	const artifact = await loadPatchArtifact(artifactId);
	const patchFile = path.resolve(artifactRoot(), artifact.storageKey);
	const localPath = artifact.run.repo?.localPath ?? undefined;
	const command =
		localPath === undefined
			? `git apply ${shellQuote(patchFile)}`
			: `git -C ${shellQuote(localPath)} apply ${shellQuote(patchFile)}`;
	if (artifact.appliedAt !== null) {
		return {
			canApply: false,
			reason: "Already applied.",
			command,
			appliedAt: artifact.appliedAt.toISOString(),
		};
	}
	if (localPath === undefined) {
		return { canApply: false, reason: "This repo has no local checkout path.", command };
	}
	const reason = await patchApplyBlocker(localPath, artifact.run.baseRef ?? undefined, patchFile);
	return reason === undefined
		? { canApply: true, command }
		: { canApply: false, reason, command };
}

/**
 * Apply the patch to the repo's checkout, if `patchApplyStatus` allows it, and
 * record when. Refuses with the reason otherwise.
 */
export async function applyRunPatch(
	artifactId: string,
): Promise<{ files: string[]; appliedAt: string }> {
	const status = await patchApplyStatus(artifactId);
	if (!status.canApply) {
		throw new ValidationError(status.reason ?? "The patch cannot be applied.", { artifactId });
	}
	const artifact = await loadPatchArtifact(artifactId);
	const localPath = artifact.run.repo?.localPath;
	if (localPath === null || localPath === undefined) {
		throw new ValidationError("This repo has no local checkout path.", { artifactId });
	}
	const patchFile = path.resolve(artifactRoot(), artifact.storageKey);
	await applyPatchFile(localPath, patchFile);
	const appliedAt = new Date();
	await prisma.artifact.update({ where: { id: artifactId }, data: { appliedAt } });
	return {
		files: patchFiles(await readFile(patchFile, "utf8")),
		appliedAt: appliedAt.toISOString(),
	};
}
