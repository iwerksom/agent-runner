/**
 * Purpose: resolve Arnold's on-disk locations to absolute paths that do not
 * depend on which directory a process happened to start in.
 *
 * This matters more than it looks. `pnpm dev` runs Next with cwd `apps/web`,
 * `pnpm seed` runs with cwd `packages/core`, and a worker will run from the repo
 * root. A relative default like "./workspaces" therefore resolved to a different
 * directory per entry point, and the dev-server case was the damaging one: it put
 * a bare git mirror and a full worktree checkout of the target repo inside the
 * Next app directory, where the file watcher would try to compile it.
 *
 * So relative values resolve against the repo root, never the cwd, and the
 * default for workspaces sits outside the repo entirely.
 */

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walks up from this file looking for the workspace marker. Works from source
 * under packages/core/src and from a bundled copy inside .next, because it keys
 * off pnpm-workspace.yaml rather than a fixed number of parent hops.
 */
function findRepoRoot(): string {
	let current = path.dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 12; depth += 1) {
		if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	// Last resort. Better than silently writing somewhere unexpected, and the
	// caller's paths stay absolute either way.
	return process.cwd();
}

let cachedRepoRoot: string | undefined;

export function repoRoot(): string {
	cachedRepoRoot ??= findRepoRoot();
	return cachedRepoRoot;
}

/** Absolute path from an env value, resolving relative values against the repo root. */
function resolveFromRepoRoot(configured: string | undefined, fallback: string): string {
	const value = configured !== undefined && configured !== "" ? configured : fallback;
	return path.isAbsolute(value) ? value : path.resolve(repoRoot(), value);
}

/**
 * Where bare mirrors and leased worktrees live. Defaults OUTSIDE the repo: a
 * checkout of the target repo inside this one would be watched by the dev
 * server, picked up by tsc and knip, and mistaken for source.
 */
export function workspaceRoot(): string {
	return resolveFromRepoRoot(
		process.env.ARNOLD_WORKSPACE_ROOT,
		path.join(os.tmpdir(), "arnold-workspaces"),
	);
}

/** Where collected artifacts are stored. Phase 1 replaces this with an object store. */
export function artifactRoot(): string {
	return resolveFromRepoRoot(process.env.ARNOLD_ARTIFACT_ROOT, ".arnold/artifacts");
}
