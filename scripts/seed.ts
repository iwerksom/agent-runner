/**
 * Purpose: bring an empty database up to a runnable Phase 0 state — one Repo row,
 * one operator, and the registry reconciled against the repo's .claude directory.
 *
 * Idempotent: every write is an upsert, so this is also the "rescan the registry"
 * command. A missing checkout is a warning rather than a failure, because the row
 * has to exist before anyone can point it at the right path.
 *
 * Run with `pnpm seed` from the repo root.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { disconnectPrisma, prisma, syncRegistry } from "../packages/core/src/index.js";

/**
 * The seeded repo, all env-driven so Arnold can be pointed at any project
 * without editing code. The defaults describe the bundled reference registry
 * rather than any real repository.
 *
 * The slug matters beyond display: `registry/<slug>/` is where this repo's
 * manifests are looked up. Change TARGET_REPO_SLUG and you must add a matching
 * directory under registry/ and register it in registry/index.ts.
 *
 * Only the FIRST repo row comes from here. An empty database has no console to
 * add a row from, so the environment seeds one and `/repos` owns every repo
 * after that. Re-running seed is still safe: it upserts this one row and
 * re-syncs, and leaves repos added in the console alone.
 */
const DEFAULT_SLUG = "example-repo";
const DEFAULT_NAME = "Example Repo";
const DEFAULT_REMOTE = "https://github.com/your-account/your-repo.git";
const OPERATOR_EMAIL = process.env.ARNOLD_OPERATOR_EMAIL ?? "operator@localhost";

function environmentValue(name: string): string | undefined {
	const value = process.env[name];
	return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

async function main(): Promise<void> {
	const configuredPath = environmentValue("TARGET_REPO_PATH");
	const localPath = configuredPath === undefined ? undefined : path.resolve(configuredPath);
	const remoteUrl = environmentValue("TARGET_REPO_REMOTE") ?? DEFAULT_REMOTE;
	// `TARGET_repoSlug` is the name this variable shipped with, and it disagreed
	// with the one .env.example and SETUP-WSL.md documented. Env names are
	// case-sensitive, so anyone following the docs silently got the default and
	// the wrong registry directory. The documented name wins; the original is
	// still read so an existing .env.local does not change meaning on upgrade.
	const repoSlug =
		environmentValue("TARGET_REPO_SLUG") ?? environmentValue("TARGET_repoSlug") ?? DEFAULT_SLUG;

	const repoFields = {
		name: environmentValue("TARGET_REPO_NAME") ?? DEFAULT_NAME,
		remoteUrl,
		localPath: localPath ?? null,
	};
	const repoRow = await prisma.repo.upsert({
		where: { slug: repoSlug },
		create: { slug: repoSlug, ...repoFields },
		update: repoFields,
	});
	console.log(`repo: ${repoRow.slug} -> ${repoRow.localPath ?? repoRow.remoteUrl}`);

	if (localPath === undefined) {
		console.warn(
			"warning: TARGET_REPO_PATH is not set. The repo row is seeded, but Arnold will have to clone from the remote and cannot verify prompt files. Set it in .env.local and re-run.",
		);
	} else if (!existsSync(localPath)) {
		console.warn(
			`warning: ${localPath} does not exist on this machine. The repo row is seeded, but prompt files could not be verified, so orphan and unregistered detection was skipped.`,
		);
	} else if (!existsSync(path.join(localPath, ".git"))) {
		console.warn(
			`warning: ${localPath} exists but is not a git checkout. Workspace leases clone from it, so they will fail until it is one.`,
		);
	}

	const operatorRow = await prisma.user.upsert({
		where: { email: OPERATOR_EMAIL },
		create: { email: OPERATOR_EMAIL, role: "operator" },
		update: {},
	});
	console.log(`operator: ${operatorRow.email} (${operatorRow.role})`);

	const sync = await syncRegistry(repoSlug);
	console.log(`\nregistry sync for ${repoSlug}:`);
	console.log(`  active:       ${sync.upserted.length > 0 ? sync.upserted.join(", ") : "none"}`);
	console.log(`  orphaned:     ${sync.orphaned.length > 0 ? sync.orphaned.join(", ") : "none"}`);
	console.log(
		`  unregistered: ${sync.unregistered.length > 0 ? sync.unregistered.join(", ") : "none"}`,
	);
	if (sync.driftWarnings.length === 0) {
		console.log("  drift:        none");
	} else {
		console.log("  drift:");
		for (const warning of sync.driftWarnings) console.log(`    - ${warning}`);
	}
}

// Written without top-level await so the script behaves the same whichever module
// format tsx picks for it.
main()
	.then(() => {
		console.log("\nseed complete.");
	})
	.catch((caught: unknown) => {
		console.error("\nseed failed:", caught);
		process.exitCode = 1;
	})
	.finally(() => disconnectPrisma());
