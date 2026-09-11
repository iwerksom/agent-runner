/**
 * Purpose: the write side of the `Repo` entity, so onboarding a target repo is an
 * operator action in the console rather than an edit to `.env.local` followed by
 * `pnpm seed`.
 *
 * `scripts/seed.ts` still seeds one repo from `TARGET_REPO_*`, because a fresh
 * database needs a row before there is a UI to add one from. Everything after
 * that first row goes through here. Both paths converge on the same upsert, so a
 * repo added in the console and a repo seeded from the environment are
 * indistinguishable afterwards.
 *
 * Two rules this module exists to enforce:
 *
 *   1. **A checkout is probed before it is trusted.** Pointing Arnold at a path
 *      that is not a git checkout does not fail at registration time, it fails
 *      several minutes later inside a workspace lease, which is the worst place
 *      to discover a typo. `probeCheckout` answers the question up front and the
 *      answer is shown in the form.
 *
 *   2. **Run history outranks tidiness.** A repo with runs cannot be deleted,
 *      only archived. `Run.repoId` is nullable and would be set to null by a
 *      delete, silently stripping the provenance the Notary exists to record.
 *      See DECISIONS #16.
 */

import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { prisma } from "./db.js";
import { NotFoundError, ValidationError } from "./errors.js";
import { discardRepoWorkspaces } from "./workspace.js";

const execFileAsync = promisify(execFile);

/**
 * A slug is a directory name under `registry/`, so it has to survive being one.
 * Lowercase because `registry/Foo` and `registry/foo` are the same directory on
 * Windows and macOS and two different ones on Linux.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/** What `probeCheckout` found on disk. Every field is a fact, not a verdict. */
export type CheckoutProbe = {
	/** Absolute, normalised path that was probed. */
	probedPath: string;
	exists: boolean;
	isDirectory: boolean;
	/** A `.git` entry is present, so `git worktree add` has something to work from. */
	isGitCheckout: boolean;
	/** The repo's own HEAD branch, offered as the default-branch default. */
	detectedBranch?: string;
	/** First remote URL, offered as the remote default. */
	detectedRemote?: string;
	/** Whether `<claudeDir>` exists, which is where registry sync looks for prompts. */
	claudeDirPresent: boolean;
	/**
	 * Operator-facing reasons this checkout is unusable. Empty means usable.
	 * Warnings that do not block registration are in `warnings`.
	 */
	blockers: string[];
	warnings: string[];
};

export type RepoInput = {
	slug: string;
	name: string;
	remoteUrl: string;
	localPath?: string;
	defaultBranch: string;
	claudeDir: string;
};

/** Every field optional: a PATCH changes only what the operator edited. */
export type RepoPatch = Partial<Omit<RepoInput, "slug">>;

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await access(candidate);
		return true;
	} catch {
		return false;
	}
}

/**
 * Runs one git command inside `cwd` and returns its trimmed stdout, or undefined
 * if git failed. Detection is best-effort: a probe that cannot read the branch
 * still reports everything else rather than throwing the whole result away.
 */
async function gitOutput(cwd: string, args: string[]): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, timeout: 5_000 });
		const trimmed = stdout.trim();
		return trimmed === "" ? undefined : trimmed;
	} catch {
		return undefined;
	}
}

/**
 * Inspect a local checkout without touching the database, so the form can tell
 * the operator what is wrong while they are still typing.
 *
 * `claudeDir` is taken as an argument rather than defaulted here because a repo
 * may keep its prompts somewhere else, and probing the wrong directory would
 * report a missing registry that is not missing.
 */
export async function probeCheckout(
	localPath: string,
	claudeDir = ".claude",
): Promise<CheckoutProbe> {
	const probedPath = path.resolve(localPath);
	const probe: CheckoutProbe = {
		probedPath,
		exists: false,
		isDirectory: false,
		isGitCheckout: false,
		claudeDirPresent: false,
		blockers: [],
		warnings: [],
	};

	if (!path.isAbsolute(localPath)) {
		probe.warnings.push(
			`"${localPath}" is relative and was resolved against Arnold's repo root to ${probedPath}. Absolute paths are less surprising.`,
		);
	}

	let stats;
	try {
		stats = await stat(probedPath);
	} catch {
		probe.blockers.push(
			`${probedPath} does not exist on this machine. Workspace leases clone from it, so a run would fail at lease time.`,
		);
		return probe;
	}

	probe.exists = true;
	probe.isDirectory = stats.isDirectory();
	if (!probe.isDirectory) {
		probe.blockers.push(`${probedPath} is a file, not a directory.`);
		return probe;
	}

	// git is asked, not the filesystem. A `.git` entry proves nothing: a stale
	// gitfile pointing at a directory that is gone, a half-copied checkout, or a
	// `.git` the process cannot read all look identical to `stat` and all fail
	// later inside `git clone --bare`, which is exactly what this probe exists to
	// prevent.
	const gitDir = await gitOutput(probedPath, ["rev-parse", "--git-dir"]);
	if (gitDir === undefined) {
		probe.blockers.push(
			`git does not recognise ${probedPath} as a repository. Arnold mirrors the repo and adds a worktree per run, both of which need usable git metadata.`,
		);
		return probe;
	}

	// `rev-parse` walks upwards, so a plain directory nested inside a checkout
	// answers for its parent. Registering that would mirror the parent while the
	// row claims the subdirectory, so the toplevel has to be the path itself.
	const topLevel = await gitOutput(probedPath, ["rev-parse", "--show-toplevel"]);
	if (topLevel !== undefined && !(await sameDirectory(topLevel, probedPath))) {
		probe.blockers.push(
			`${probedPath} is inside the git checkout at ${topLevel}, but is not its root. Point Arnold at ${topLevel} instead.`,
		);
		return probe;
	}
	probe.isGitCheckout = true;

	const branch = await gitOutput(probedPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (branch !== undefined && branch !== "HEAD") probe.detectedBranch = branch;

	const remote = await gitOutput(probedPath, ["remote", "get-url", "origin"]);
	if (remote !== undefined) probe.detectedRemote = remote;

	probe.claudeDirPresent = await pathExists(path.join(probedPath, claudeDir));
	if (!probe.claudeDirPresent) {
		// Not a blocker: console-owned prompts render from Arnold's own tree, so a
		// repo with no `.claude` directory is a perfectly valid target.
		probe.warnings.push(
			`No ${claudeDir}/ directory here. Registry sync will find nothing to reconcile, so only agents whose manifests use console-owned prompts will be runnable.`,
		);
	}

	return probe;
}

/**
 * Whether two paths name the same directory, resolving symlinks first. Needed
 * because git reports its own resolved path, and on macOS and in WSL that
 * routinely differs textually from what the operator typed.
 */
async function sameDirectory(left: string, right: string): Promise<boolean> {
	try {
		return (await realpath(left)) === (await realpath(right));
	} catch {
		return path.resolve(left) === path.resolve(right);
	}
}

/** Rejects anything that would break `registry/<slug>/` or a URL path segment. */
function assertValidSlug(slug: string): void {
	if (!SLUG_RE.test(slug)) {
		throw new ValidationError(
			`"${slug}" is not a usable repo slug. Use lowercase letters, digits and hyphens, starting and ending with a letter or digit (for example "my-service").`,
			{ slug },
		);
	}
}

function assertNonEmpty(value: string, field: string): void {
	if (value.trim() === "") {
		throw new ValidationError(`${field} cannot be empty.`, { field });
	}
}

/**
 * Validates an input and probes its checkout. Shared by create and update so the
 * two cannot drift into accepting different things.
 *
 * A probe blocker is reported as a `ValidationError` rather than silently
 * accepted, because the alternative is a repo row that looks fine in the list and
 * fails at lease time.
 */
async function validateRepoInput(input: RepoInput): Promise<CheckoutProbe | undefined> {
	assertValidSlug(input.slug);
	assertNonEmpty(input.name, "Name");
	assertNonEmpty(input.remoteUrl, "Remote URL");
	assertNonEmpty(input.defaultBranch, "Default branch");
	assertNonEmpty(input.claudeDir, "Prompt directory");

	if (input.localPath === undefined || input.localPath.trim() === "") return undefined;

	const probe = await probeCheckout(input.localPath, input.claudeDir);
	if (probe.blockers.length > 0) {
		throw new ValidationError(probe.blockers.join(" "), {
			localPath: probe.probedPath,
			blockers: probe.blockers,
		});
	}
	return probe;
}

/** Normalised fields ready for a Prisma write. `localPath` is null, never "". */
function repoFieldsOf(
	input: RepoInput,
): Omit<RepoInput, "localPath"> & { localPath: string | null } {
	const localPath =
		input.localPath === undefined || input.localPath.trim() === ""
			? null
			: path.resolve(input.localPath.trim());
	return {
		slug: input.slug,
		name: input.name.trim(),
		remoteUrl: input.remoteUrl.trim(),
		localPath,
		defaultBranch: input.defaultBranch.trim(),
		claudeDir: input.claudeDir.trim(),
	};
}

export async function createRepo(input: RepoInput): Promise<{ slug: string }> {
	await validateRepoInput(input);

	const existing = await prisma.repo.findUnique({ where: { slug: input.slug } });
	if (existing !== null) {
		throw new ValidationError(
			`A repo with slug "${input.slug}" already exists. Slugs are how manifests name their repos, so they have to be unique.`,
			{ slug: input.slug },
		);
	}

	const { slug, ...fields } = repoFieldsOf(input);
	const created = await prisma.repo.create({ data: { slug, ...fields } });
	return { slug: created.slug };
}

/**
 * Updates a repo in place. The slug is immutable: manifests name their repos by
 * slug and `registry/<slug>/` is a directory on disk, so renaming one here would
 * orphan every manifest that points at it. Delete and re-add is the honest path,
 * and it forces the registry directory to be renamed too.
 *
 * Changing where the code comes from is not an ordinary field edit. The bare
 * mirror is cloned once and keyed by slug, and `ensureMirror` refreshes it by
 * fetching its own origin — so a new `localPath` or `remoteUrl` would be
 * recorded and then ignored, and every later run would execute the old source
 * while the console showed the new one. Runs would keep succeeding, against code
 * nobody pointed at. So a source change discards the mirror and every worktree
 * derived from it, and the next lease re-clones. That is refused while any
 * workspace is leased, which surfaces as a WorkspaceError naming the count.
 */
export async function updateRepo(slug: string, patch: RepoPatch): Promise<{ slug: string }> {
	const existing = await prisma.repo.findUnique({ where: { slug } });
	if (existing === null) throw new NotFoundError(`no repo "${slug}"`, { slug });

	const merged: RepoInput = {
		slug,
		name: patch.name ?? existing.name,
		remoteUrl: patch.remoteUrl ?? existing.remoteUrl,
		localPath: patch.localPath ?? existing.localPath ?? undefined,
		defaultBranch: patch.defaultBranch ?? existing.defaultBranch,
		claudeDir: patch.claudeDir ?? existing.claudeDir,
	};
	await validateRepoInput(merged);

	const { slug: _slug, ...fields } = repoFieldsOf(merged);
	const sourceChanged =
		fields.localPath !== existing.localPath || fields.remoteUrl !== existing.remoteUrl;

	// Discard before the write. If the mirror cannot be rebuilt right now the
	// edit must not land either, or the row and the disk disagree — which is the
	// exact state this is here to prevent.
	if (sourceChanged) await discardRepoWorkspaces(slug);

	const updated = await prisma.repo.update({ where: { slug }, data: fields });
	return { slug: updated.slug };
}

export type RepoRemovalPlan = {
	slug: string;
	runCount: number;
	agentCount: number;
	/** Worktrees this repo owns. A leased one means a run is using it right now. */
	workspaceCount: number;
	leasedWorkspaceCount: number;
	/** Which removals the current state permits. */
	canDelete: boolean;
	canArchive: boolean;
	/** Why `canDelete` is false, in operator words. Empty when it is true. */
	deleteBlockers: string[];
};

/**
 * What removing this repo would mean, computed before anything is removed so the
 * confirmation dialog can state the consequence rather than ask for a leap of
 * faith.
 */
export async function planRepoRemoval(slug: string): Promise<RepoRemovalPlan> {
	const repoRow = await prisma.repo.findUnique({
		where: { slug },
		include: { _count: { select: { runs: true, agents: true, workspaces: true } } },
	});
	if (repoRow === null) throw new NotFoundError(`no repo "${slug}"`, { slug });

	const leasedWorkspaceCount = await prisma.workspace.count({
		where: { repoId: repoRow.id, state: { in: ["leased", "destroying"] } },
	});

	const deleteBlockers: string[] = [];
	if (repoRow._count.runs > 0) {
		deleteBlockers.push(
			repoRow._count.runs === 1
				? "1 run references this repo. Deleting it would detach that run from the repo it ran against, losing the provenance the run record exists to hold. Archive it instead."
				: `${repoRow._count.runs} runs reference this repo. Deleting it would detach them from the repo they ran against, losing the provenance the run record exists to hold. Archive it instead.`,
		);
	}
	if (leasedWorkspaceCount > 0) {
		deleteBlockers.push(
			`${leasedWorkspaceCount} workspace${leasedWorkspaceCount === 1 ? " is" : "s are"} still leased. Wait for those runs to finish or cancel them first.`,
		);
	}

	return {
		slug,
		runCount: repoRow._count.runs,
		agentCount: repoRow._count.agents,
		workspaceCount: repoRow._count.workspaces,
		leasedWorkspaceCount,
		canDelete: deleteBlockers.length === 0,
		canArchive: repoRow.archivedAt === null,
		deleteBlockers,
	};
}

/**
 * Retires a repo without touching its history. Archived repos keep every run,
 * artifact and outcome, and are excluded from the switcher and from anything
 * that can start a new run.
 */
export async function archiveRepo(slug: string): Promise<{ slug: string }> {
	const existing = await prisma.repo.findUnique({ where: { slug } });
	if (existing === null) throw new NotFoundError(`no repo "${slug}"`, { slug });
	if (existing.archivedAt !== null) return { slug };

	await prisma.repo.update({ where: { slug }, data: { archivedAt: new Date() } });
	return { slug };
}

export async function unarchiveRepo(slug: string): Promise<{ slug: string }> {
	const existing = await prisma.repo.findUnique({ where: { slug } });
	if (existing === null) throw new NotFoundError(`no repo "${slug}"`, { slug });

	await prisma.repo.update({ where: { slug }, data: { archivedAt: null } });
	return { slug };
}

/**
 * The error a blocked delete produces, wherever it was detected. One message for
 * the preflight plan and for the database's own refusal, so an operator who
 * loses the race reads the same sentence as one who never started it.
 */
function blockedDeleteError(slug: string, blockers: string[]): ValidationError {
	return new ValidationError(
		blockers.length > 0
			? blockers.join(" ")
			: `"${slug}" cannot be deleted because something still references it. Archive it instead.`,
		{ slug, blockers },
	);
}

/**
 * Removes a repo permanently. Only legal while nothing references it: a repo
 * that has ever run something is archived, never deleted.
 *
 * The count is re-read inside a transaction rather than trusted from
 * `planRepoRemoval`. Dispatch can create a run between the plan and the delete,
 * and the plan is computed for a dialog — by the time the operator presses the
 * button it is seconds old. `Run.repo` is additionally declared `onDelete:
 * Restrict`, so even if both checks were wrong the database refuses rather than
 * nulling `repoId`; that refusal is caught and reported as the same blocked
 * delete. Belt, braces, and a third thing, because the failure is silent and
 * unrecoverable: a detached run cannot be re-attached, only guessed at.
 *
 * `AgentRepo` and `Workspace` rows cascade. The worktree directories those
 * `Workspace` rows describe are NOT removed here — that is the workspace pool's
 * job and it needs the executor, so the plan reports the count and the operator
 * is told what is left behind.
 */
export async function deleteRepo(slug: string): Promise<{ slug: string; workspaceCount: number }> {
	const plan = await planRepoRemoval(slug);
	if (!plan.canDelete) throw blockedDeleteError(slug, plan.deleteBlockers);

	try {
		return await prisma.$transaction(async (tx) => {
			const repoRow = await tx.repo.findUnique({
				where: { slug },
				include: { _count: { select: { runs: true, workspaces: true } } },
			});
			if (repoRow === null) throw new NotFoundError(`no repo "${slug}"`, { slug });

			if (repoRow._count.runs > 0) {
				throw blockedDeleteError(slug, [
					`A run was recorded against "${slug}" while this deletion was being confirmed, so it was not deleted. Archive it instead.`,
				]);
			}
			const busy = await tx.workspace.count({
				where: { repoId: repoRow.id, state: { in: ["leased", "destroying"] } },
			});
			if (busy > 0) {
				throw blockedDeleteError(slug, [
					`A workspace for "${slug}" was leased while this deletion was being confirmed, so it was not deleted.`,
				]);
			}

			await tx.repo.delete({ where: { slug } });
			return { slug, workspaceCount: repoRow._count.workspaces };
		});
	} catch (caught: unknown) {
		// Prisma reports a refused foreign key as P2003. Reaching this means both
		// checks above were raced, which should be impossible — but "impossible"
		// is how the detached runs in this database happened.
		const code = (caught as { code?: unknown } | null)?.code;
		if (code === "P2003") throw blockedDeleteError(slug, []);
		throw caught;
	}
}
