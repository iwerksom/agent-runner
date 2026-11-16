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
 * `onChanges: "branch"` and `"commit"` go further without a click (#79): Arnold
 * commits the changes on `arnold/<agent>/<run>` and fetches that branch into the
 * checkout, and for `commit` fast-forwards the checkout's branch when it has not
 * moved since the run started. The commit is Arnold's, message and author; the
 * model writes neither. Nothing here merges, rebases, forces or pushes.
 *
 * The git work is split from the database work so the smoke test can run it
 * against throwaway repos without a Run row.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Artifact } from "@prisma/client";
import type { OnChanges } from "./agents.js";
import { prisma } from "./db.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { stringifyJsonColumn } from "./json.js";
import { artifactRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

/** The store is for reports, not builds; a patch bigger than this is skipped. */
const MAX_PATCH_BYTES = 5 * 1024 * 1024;

export const PATCH_ARTIFACT_PATH = "changes.patch";
export const PATCH_ARTIFACT_KIND = "patch";

async function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
			maxBuffer: 64 * 1024 * 1024,
			...(env === undefined ? {} : { env: { ...process.env, ...env } }),
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

/** Who Arnold's commits are by. Never the operator's own git identity. */
export type CommitIdentity = { name: string; email: string };

/** `ARNOLD_GIT_NAME` and `ARNOLD_GIT_EMAIL`, with a default that cannot be mistaken for a person. */
export function arnoldCommitIdentity(
	env: Record<string, string | undefined> = process.env,
): CommitIdentity {
	const name = env["ARNOLD_GIT_NAME"]?.trim();
	const email = env["ARNOLD_GIT_EMAIL"]?.trim();
	return {
		name: name === undefined || name === "" ? "Arnold" : name,
		email: email === undefined || email === "" ? "arnold@localhost" : email,
	};
}

/** `arnold/<agent>/<run>`: one branch per run, so two runs never share a ref. */
export function runBranchName(agentId: string, runId: string): string {
	return `arnold/${agentId}/${runId}`;
}

/** Arnold's commit message for a run's changes. Facts about the run, no model text. */
export function runCommitMessage(input: {
	agentId: string;
	runId: string;
	baseRef: string;
	baseSha: string;
}): string {
	return [
		`${input.agentId}: changes from run ${input.runId}`,
		"",
		`Agent: ${input.agentId}`,
		`Run: ${input.runId}`,
		`Base: ${input.baseRef} @ ${input.baseSha.slice(0, 7)}`,
		"",
		"Committed by Arnold after the run. The agent did not write this message.",
	].join("\n");
}

/**
 * Commit the worktree's changes on top of `baseSha` and point `branch` at the
 * commit, in the repository the worktree belongs to. Returns the commit sha, or
 * undefined when there is nothing to commit.
 *
 * Built with plumbing and a throwaway index, so the worktree is left exactly as
 * the run left it: HEAD stays detached at the base, nothing is staged, and
 * `git diff` there still shows the run's edits. No hook runs, because
 * `commit-tree` has none. Gitignored files stay out, as they do in the patch.
 * The branch must not exist yet; a run id is never reused, so one that does is
 * not this run's.
 */
export async function commitWorktreeChanges(input: {
	workspacePath: string;
	baseSha: string;
	branch: string;
	message: string;
	identity: CommitIdentity;
}): Promise<string | undefined> {
	const { workspacePath, baseSha, branch, message, identity } = input;
	await git(workspacePath, ["check-ref-format", "--branch", branch]);
	const scratch = await mkdtemp(path.join(os.tmpdir(), "arnold-index-"));
	try {
		const index = { GIT_INDEX_FILE: path.join(scratch, "index") };
		await git(workspacePath, ["read-tree", baseSha], index);
		await git(workspacePath, ["add", "-A", "--", "."], index);
		const tree = (await git(workspacePath, ["write-tree"], index)).trim();
		const baseTree = (await git(workspacePath, ["rev-parse", `${baseSha}^{tree}`])).trim();
		if (tree === baseTree) return undefined;
		const commitSha = (
			await git(workspacePath, ["commit-tree", tree, "-p", baseSha, "-m", message], {
				GIT_AUTHOR_NAME: identity.name,
				GIT_AUTHOR_EMAIL: identity.email,
				GIT_COMMITTER_NAME: identity.name,
				GIT_COMMITTER_EMAIL: identity.email,
			})
		).trim();
		// The empty old value means "only if the ref does not exist".
		await git(workspacePath, ["update-ref", `refs/heads/${branch}`, commitSha, ""]);
		return commitSha;
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/**
 * Bring `branch` from the worktree's repository into the checkout as a branch of
 * the same name. The checkout's HEAD, index and files are not touched; a fetch
 * into a branch that is checked out is refused by git itself.
 */
export async function fetchRunBranch(
	localPath: string,
	workspacePath: string,
	branch: string,
): Promise<void> {
	const source = (
		await git(workspacePath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
	).trim();
	await git(localPath, [
		"fetch",
		"--quiet",
		"--no-tags",
		source,
		`refs/heads/${branch}:refs/heads/${branch}`,
	]);
}

/**
 * Why the checkout's branch cannot be fast-forwarded to a run's commit, or
 * undefined when it can. The commit's parent is the run's base, so the move is a
 * fast-forward exactly when the branch tip is still that base; the branch must be
 * the one checked out and the tree clean, because the files change with it.
 */
export async function fastForwardBlocker(
	localPath: string,
	baseRef: string,
	baseSha: string,
): Promise<string | undefined> {
	let current: string;
	try {
		current = (await git(localPath, ["symbolic-ref", "--short", "-q", "HEAD"])).trim();
	} catch {
		return `the checkout is on a detached HEAD, not on ${baseRef}`;
	}
	if (current !== baseRef) {
		return `the checkout is on "${current}", and the run started from "${baseRef}"`;
	}
	const tip = (await git(localPath, ["rev-parse", "HEAD"])).trim();
	if (tip !== baseSha) {
		return `${baseRef} has moved since the run started (it is at ${tip.slice(0, 7)}, the run started from ${baseSha.slice(0, 7)})`;
	}
	if ((await git(localPath, ["status", "--porcelain"])).trim() !== "") {
		return "the checkout has uncommitted changes";
	}
	return undefined;
}

/** Fast-forward the checked-out branch to `commitSha`. Fails rather than merge. */
export async function fastForwardCheckout(localPath: string, commitSha: string): Promise<void> {
	await git(localPath, ["merge", "--ff-only", "--quiet", commitSha]);
}

/**
 * How a run's changes were delivered. `reached` is how far they got:
 *
 *   mirror   committed, but the branch is only in Arnold's mirror (no checkout,
 *            or the fetch failed); `note` says why
 *   branch   the branch is in the checkout; the checkout's own branch is untouched
 *   commit   the checkout's branch was fast-forwarded to the commit
 *   nothing  no commit could be made; `note` says why, and the patch still stands
 */
export type ChangesDelivery = {
	/** What the manifest asked for. */
	mode: Exclude<OnChanges, "patch">;
	reached: "nothing" | "mirror" | "branch" | "commit";
	branch?: string;
	commitSha?: string;
	/** Why it stopped short of `mode`. */
	note?: string;
};

function firstLineOf(caught: unknown): string {
	return (String(caught).split("\n")[0] ?? "").replace(/^Error: /, "");
}

/**
 * Deliver a run's changes as `mode` asks, falling back one level at a time and
 * saying why: `commit` to `branch` when the checkout is not where the run
 * started, `branch` to the mirror when there is no checkout to fetch into.
 * Returns undefined when the run changed nothing.
 *
 * Never throws, for the same reason `capturePatch` does not.
 */
export async function deliverWorktreeChanges(input: {
	mode: Exclude<OnChanges, "patch">;
	workspacePath: string;
	baseRef: string;
	baseSha: string;
	/** The repo's checkout, when it has one. */
	localPath: string | undefined;
	agentId: string;
	runId: string;
	identity: CommitIdentity;
}): Promise<ChangesDelivery | undefined> {
	const { mode, workspacePath, baseRef, baseSha, localPath, agentId, runId } = input;
	const branch = runBranchName(agentId, runId);
	let commitSha: string | undefined;
	try {
		commitSha = await commitWorktreeChanges({
			workspacePath,
			baseSha,
			branch,
			message: runCommitMessage({ agentId, runId, baseRef, baseSha }),
			identity: input.identity,
		});
	} catch (caught: unknown) {
		return { mode, reached: "nothing", note: `could not commit: ${firstLineOf(caught)}` };
	}
	if (commitSha === undefined) return undefined;
	const committed = { mode, branch, commitSha };

	if (localPath === undefined) {
		return { ...committed, reached: "mirror", note: "this repo has no local checkout path" };
	}
	try {
		await fetchRunBranch(localPath, workspacePath, branch);
	} catch (caught: unknown) {
		return {
			...committed,
			reached: "mirror",
			note: `could not fetch into the checkout: ${firstLineOf(caught)}`,
		};
	}
	if (mode === "branch") return { ...committed, reached: "branch" };

	try {
		const blocker = await fastForwardBlocker(localPath, baseRef, baseSha);
		if (blocker !== undefined) {
			return { ...committed, reached: "branch", note: `not fast-forwarded: ${blocker}` };
		}
		await fastForwardCheckout(localPath, commitSha);
		return { ...committed, reached: "commit" };
	} catch (caught: unknown) {
		return {
			...committed,
			reached: "branch",
			note: `not fast-forwarded: ${firstLineOf(caught)}`,
		};
	}
}

/**
 * Deliver a run's changes and record the result on the Run row: the branch and
 * commit in the Notary's own columns, the rest in `changesDelivery`. When the
 * checkout was fast-forwarded the patch is marked applied, so the run page does
 * not offer to apply it a second time.
 */
export async function deliverRunChanges(input: {
	mode: Exclude<OnChanges, "patch">;
	runId: string;
	agentId: string;
	workspacePath: string;
	baseRef: string;
	baseSha: string;
	localPath: string | undefined;
}): Promise<ChangesDelivery | undefined> {
	try {
		const delivery = await deliverWorktreeChanges({
			...input,
			identity: arnoldCommitIdentity(),
		});
		if (delivery === undefined) return undefined;
		await prisma.run.update({
			where: { id: input.runId },
			data: {
				changesDelivery: stringifyJsonColumn(delivery),
				...(delivery.branch === undefined ? {} : { branch: delivery.branch }),
				...(delivery.commitSha === undefined ? {} : { headSha: delivery.commitSha }),
			},
		});
		if (delivery.reached === "commit") {
			await prisma.artifact.updateMany({
				where: { runId: input.runId, kind: PATCH_ARTIFACT_KIND, appliedAt: null },
				data: { appliedAt: new Date() },
			});
		}
		return delivery;
	} catch (caught: unknown) {
		console.warn(
			`[arnold] could not deliver the changes of run ${input.runId}: ${String(caught)}`,
		);
		return undefined;
	}
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
