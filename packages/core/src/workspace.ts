/**
 * Purpose: lease a git worktree for a run, primed to an exact base ref, and hand
 * it back afterwards.
 *
 * One bare mirror per repo under <root>/mirrors, one worktree per lease under
 * <root>/worktrees. The mirror is cloned from the repo's LOCAL checkout when it
 * has one, which is deliberate: Phase 0 runs with no network and no deploy key,
 * and a local clone source makes that work without special-casing anything else.
 *
 * A dirty worktree is never reused. Reusing one would let one run's leftovers
 * appear in another run's diff, which is the one failure mode that would make
 * every provenance record in the Notary untrustworthy.
 */

import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Repo } from "@prisma/client";
import type { AgentManifest } from "./agents.js";
import { prisma } from "./db.js";
import { StateMissingError, WorkspaceError } from "./errors.js";
import { workspaceRoot } from "./paths.js";

const execFileAsync = promisify(execFile);

export type WorkspaceLease = {
	workspaceId: string;
	workspacePath: string;
	workspaceBaseRef: string;
	workspaceBaseSha: string;
};

export type LeaseWorkspaceInput = {
	repo: Repo;
	baseRef: string;
	manifest: Pick<AgentManifest, "id" | "statePaths">;
	runId: string;
};

// Re-exported so existing importers keep working; the resolution rules (and why
// the default lives outside the repo) are in paths.ts.
export { workspaceRoot };

function mirrorPathFor(repoSlug: string): string {
	return path.join(workspaceRoot(), "mirrors", `${repoSlug}.git`);
}

type GitResult = { gitStdout: string; gitStderr: string };

/**
 * Run one git command. Everything git-shaped goes through here so a failure
 * always surfaces as a WorkspaceError carrying git's own stderr — the operator
 * needs git's wording, not ours.
 */
async function runGit(args: string[], cwd?: string): Promise<GitResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			...(cwd === undefined ? {} : { cwd }),
			maxBuffer: 32 * 1024 * 1024,
		});
		return { gitStdout: stdout.toString(), gitStderr: stderr.toString() };
	} catch (caught: unknown) {
		const detail = gitFailureDetail(caught);
		throw new WorkspaceError(`git ${args.join(" ")} failed: ${detail}`, {
			gitArgs: args,
			gitCwd: cwd,
		});
	}
}

function gitFailureDetail(caught: unknown): string {
	if (typeof caught === "object" && caught !== null) {
		const record = caught as { stderr?: unknown; message?: unknown; code?: unknown };
		const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
		if (stderr !== "") return stderr;
		if (record.code === "ENOENT") return "git is not installed or not on PATH";
		if (typeof record.message === "string") return record.message;
	}
	return String(caught);
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

/**
 * Create the bare mirror if absent, otherwise refresh it. A failed refresh is
 * logged rather than thrown: a stale mirror still resolves existing refs, and
 * Phase 0 is expected to run offline.
 */
async function ensureMirror(repo: Repo): Promise<string> {
	const mirror = mirrorPathFor(repo.slug);
	if (await pathExists(mirror)) {
		try {
			await runGit(["--git-dir=" + mirror, "fetch", "origin", "+refs/heads/*:refs/heads/*"]);
		} catch (caught: unknown) {
			console.warn(
				`[arnold] mirror refresh failed for ${repo.slug}; continuing with the existing mirror. ${String(caught)}`,
			);
		}
		return mirror;
	}

	const cloneSource = repo.localPath ?? repo.remoteUrl;
	if (cloneSource === "") {
		throw new WorkspaceError(
			`repo ${repo.slug} has neither a localPath nor a remoteUrl to clone from`,
			{ repoSlug: repo.slug },
		);
	}
	await mkdir(path.dirname(mirror), { recursive: true });
	await runGit(["clone", "--bare", cloneSource, mirror]);
	return mirror;
}

/**
 * Paths a bookkeeping commit or push would touch: the staged diff for a commit,
 * the not-yet-pushed commits for a push. This is the read half of the
 * guarded-push helper named in the `MainBookkeeping` contract; the decision half
 * is `buildCanUseTool`, which stays free of `child_process` so it can be
 * exercised without a real worktree.
 *
 * git prints forward slashes on every platform, so the result is directly
 * comparable against the manifest's globs with no separator juggling.
 *
 * `againstRef` is the branch a push would land on, and it is compared as a bare
 * name rather than through `@{upstream}` or `origin/<name>`. Neither of those
 * resolves here: a leased worktree sits on a detached HEAD, so it has no upstream,
 * and the mirror fetches `+refs/heads/*:refs/heads/*`, so it holds `refs/heads/main`
 * and no remote-tracking refs at all. The bare name is therefore the mirror's copy
 * of the branch, which is exactly the pre-push state the diff wants.
 */
export async function readBookkeepingPaths(
	workspacePath: string,
	kind: "staged" | "unpushed",
	againstRef?: string,
): Promise<string[]> {
	if (kind === "unpushed" && (againstRef === undefined || againstRef === "")) {
		throw new WorkspaceError(
			"readBookkeepingPaths needs a ref to compare an unpushed diff against",
			{
				workspacePath,
			},
		);
	}
	const args =
		kind === "staged"
			? ["-C", workspacePath, "diff", "--cached", "--name-only"]
			: ["-C", workspacePath, "diff", "--name-only", `${againstRef}..HEAD`];
	const { gitStdout } = await runGit(args);
	return gitStdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** True when the worktree has no tracked or untracked changes. */
export async function isWorkspaceClean(workspacePath: string): Promise<boolean> {
	const { gitStdout } = await runGit(["-C", workspacePath, "status", "--porcelain"]);
	return gitStdout.trim() === "";
}

/** Reset the worktree to `baseRef` and return the sha it landed on. */
async function primeWorktree(worktreePath: string, baseRef: string): Promise<string> {
	try {
		// The worktree's git-dir is the mirror, so this fetch re-reads the clone
		// source. Offline is normal in Phase 0, so a failure is not fatal.
		await runGit(["-C", worktreePath, "fetch"]);
	} catch (caught: unknown) {
		console.warn(
			`[arnold] fetch in ${worktreePath} failed; using local refs. ${String(caught)}`,
		);
	}
	await runGit(["-C", worktreePath, "reset", "--hard", baseRef]);
	await runGit(["-C", worktreePath, "clean", "-fdx"]);
	const { gitStdout } = await runGit(["-C", worktreePath, "rev-parse", "HEAD"]);
	return gitStdout.trim();
}

/**
 * Fail the lease before the model sees anything when a required state path is
 * absent. The manifest's `missingHint` is written for the operator, so it is used
 * verbatim when present.
 */
async function verifyStatePaths(
	worktreePath: string,
	manifest: Pick<AgentManifest, "id" | "statePaths">,
): Promise<void> {
	for (const statePath of manifest.statePaths) {
		if (!statePath.required || statePath.source !== "repo") continue;
		if (await pathExists(path.join(worktreePath, statePath.path))) continue;
		throw new StateMissingError(
			statePath.missingHint ??
				`${manifest.id} requires ${statePath.path} in the checkout, and it is not there.`,
			{ agentId: manifest.id, statePath: statePath.path },
		);
	}
}

/**
 * Lease a worktree for `runId`. Reuses an idle one when available, and always
 * primes it to `baseRef` before returning.
 */
export async function leaseWorkspace(input: LeaseWorkspaceInput): Promise<WorkspaceLease> {
	const { repo, baseRef, manifest, runId } = input;
	const mirror = await ensureMirror(repo);

	const idleRow = await prisma.workspace.findFirst({
		where: { repoId: repo.id, state: "idle" },
		orderBy: { lastUsedAt: "asc" },
	});

	let workspaceId: string;
	let worktreePath: string;

	if (idleRow !== null && (await pathExists(idleRow.path))) {
		workspaceId = idleRow.id;
		worktreePath = idleRow.path;
		// Claimed before priming so a concurrent lease cannot pick the same row.
		await prisma.workspace.update({
			where: { id: workspaceId },
			data: { state: "leased", leasedByRun: runId, leasedAt: new Date() },
		});
	} else {
		const existingCount = await prisma.workspace.count({ where: { repoId: repo.id } });
		worktreePath = path.join(workspaceRoot(), "worktrees", `${repo.slug}-${existingCount + 1}`);
		await mkdir(path.dirname(worktreePath), { recursive: true });
		await runGit(["--git-dir=" + mirror, "worktree", "add", "--detach", worktreePath, baseRef]);
		const createdRow = await prisma.workspace.create({
			data: {
				repoId: repo.id,
				path: worktreePath,
				state: "leased",
				leasedByRun: runId,
				leasedAt: new Date(),
			},
		});
		workspaceId = createdRow.id;
		if (idleRow !== null) {
			// The row pointed at a directory that is gone. Retire it so the next
			// lease does not trip over it again.
			await prisma.workspace.update({
				where: { id: idleRow.id },
				data: { state: "destroying" },
			});
		}
	}

	try {
		const workspaceBaseSha = await primeWorktree(worktreePath, baseRef);
		await verifyStatePaths(worktreePath, manifest);
		await prisma.workspace.update({
			where: { id: workspaceId },
			data: { lastUsedAt: new Date() },
		});
		return {
			workspaceId,
			workspacePath: worktreePath,
			workspaceBaseRef: baseRef,
			workspaceBaseSha,
		};
	} catch (caught: unknown) {
		// The lease never became a run, so the worktree is still clean. Return it
		// to the pool rather than leaking it.
		await prisma.workspace.update({
			where: { id: workspaceId },
			data: { state: "idle", leasedByRun: null, leasedAt: null },
		});
		throw caught;
	}
}

/**
 * Hand a worktree back. Clean goes to "idle" and is reusable; anything else goes
 * to "dirty" and stays on disk for inspection.
 */
export async function releaseWorkspace(workspaceId: string): Promise<void> {
	const row = await prisma.workspace.findUnique({ where: { id: workspaceId } });
	if (row === null) return;

	let clean: boolean;
	try {
		clean = await isWorkspaceClean(row.path);
	} catch (caught: unknown) {
		// If we cannot prove it is clean, it is dirty. Guessing the other way is
		// how one run's leftovers end up in another run's diff.
		console.warn(`[arnold] could not check ${row.path}; marking dirty. ${String(caught)}`);
		clean = false;
	}

	if (clean) {
		await prisma.workspace.update({
			where: { id: workspaceId },
			data: { state: "idle", leasedByRun: null, leasedAt: null, lastUsedAt: new Date() },
		});
		return;
	}

	await prisma.workspace.update({
		where: { id: workspaceId },
		data: { state: "dirty", leasedByRun: null, leasedAt: null, lastUsedAt: new Date() },
	});
	console.warn(
		`[arnold] workspace ${workspaceId} left dirty and kept on disk for inspection: ${row.path}`,
	);
}

/**
 * Throw away every derived checkout for a repo: its bare mirror and all of its
 * worktrees, on disk and in the database.
 *
 * Exists because the mirror is keyed by slug and cloned once. `ensureMirror`
 * refreshes an existing mirror by fetching *its own* origin, so changing a
 * repo's `localPath` or `remoteUrl` would otherwise be silently ineffective:
 * the row would name the new source while every subsequent run kept executing
 * the old one. That is the worst kind of wrong — runs succeed, against code
 * nobody pointed at.
 *
 * Refuses while anything is leased. Deleting a worktree out from under a
 * running agent would fail the run somewhere unhelpful, and the caller can
 * simply ask again once it finishes.
 *
 * Idempotent: a repo that has never run has nothing on disk, and removing
 * nothing is a success.
 */
export async function discardRepoWorkspaces(
	repoSlug: string,
): Promise<{ removedWorktrees: number }> {
	const repoRow = await prisma.repo.findUnique({ where: { slug: repoSlug } });
	if (repoRow === null) return { removedWorktrees: 0 };

	const busy = await prisma.workspace.count({
		where: { repoId: repoRow.id, state: { in: ["leased", "destroying"] } },
	});
	if (busy > 0) {
		throw new WorkspaceError(
			`${repoSlug} has ${busy} workspace${busy === 1 ? "" : "s"} in use, so its mirror cannot be rebuilt right now. Wait for those runs to finish, or cancel them, and try again.`,
			{ repoSlug, busy },
		);
	}

	const rows = await prisma.workspace.findMany({ where: { repoId: repoRow.id } });
	for (const row of rows) {
		// `force` so a worktree an operator already deleted by hand is not an
		// error: the goal is "gone", and it is already gone.
		await rm(row.path, { recursive: true, force: true });
	}
	await prisma.workspace.deleteMany({ where: { repoId: repoRow.id } });
	await rm(mirrorPathFor(repoSlug), { recursive: true, force: true });

	return { removedWorktrees: rows.length };
}
