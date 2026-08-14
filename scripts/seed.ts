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

const REPO_SLUG = "diamond-frontend";
const OPERATOR_EMAIL = "arnold@rawpowerlabs.com";
const DEFAULT_REMOTE = "https://github.com/RawPowerTools/diamond_frontend.git";

function environmentValue(name: string): string | undefined {
	const value = process.env[name];
	return value !== undefined && value.trim() !== "" ? value.trim() : undefined;
}

async function main(): Promise<void> {
	const configuredPath = environmentValue("DIAMOND_FRONTEND_PATH");
	const localPath = configuredPath === undefined ? undefined : path.resolve(configuredPath);
	const remoteUrl = environmentValue("DIAMOND_FRONTEND_REMOTE") ?? DEFAULT_REMOTE;

	const repoFields = {
		name: "Diamond Frontend",
		remoteUrl,
		localPath: localPath ?? null,
	};
	const repoRow = await prisma.repo.upsert({
		where: { slug: REPO_SLUG },
		create: { slug: REPO_SLUG, ...repoFields },
		update: repoFields,
	});
	console.log(`repo: ${repoRow.slug} -> ${repoRow.localPath ?? repoRow.remoteUrl}`);

	if (localPath === undefined) {
		console.warn(
			"warning: DIAMOND_FRONTEND_PATH is not set. The repo row is seeded, but Arnold will have to clone from the remote and cannot verify prompt files. Set it in .env.local and re-run.",
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

	const sync = await syncRegistry(REPO_SLUG);
	console.log(`\nregistry sync for ${REPO_SLUG}:`);
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
