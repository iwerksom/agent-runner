/**
 * Purpose: bring a database up to a runnable Phase 0 state — one operator, and
 * the agent library reconciled against every registered repo.
 *
 * No repo is created here. Repos are added, selected and removed from the
 * console's /repos page, which works on an empty database, so there is nothing
 * for the environment to name. On a fresh database this seeds the operator and
 * reports that there are no repos yet; after that it is the "rescan every repo"
 * command.
 *
 * Idempotent: every write is an upsert.
 *
 * Run with `pnpm seed` from the repo root.
 */

import { disconnectPrisma, prisma, syncRegistry } from "../packages/core/src/index.js";

const OPERATOR_EMAIL = process.env.ARNOLD_OPERATOR_EMAIL ?? "operator@localhost";

/**
 * The variables that used to seed a repo. Still set in an old `.env.local`, they
 * would otherwise be silently ignored, and someone expecting their repo to
 * appear would not learn why it did not.
 */
const RETIRED_ENV_VARIABLES = [
	"TARGET_REPO_PATH",
	"TARGET_REPO_REMOTE",
	"TARGET_REPO_SLUG",
	"TARGET_REPO_NAME",
	"TARGET_repoSlug",
];

async function main(): Promise<void> {
	const retired = RETIRED_ENV_VARIABLES.filter((name) => (process.env[name] ?? "").trim() !== "");
	if (retired.length > 0) {
		console.warn(
			`warning: ${retired.join(", ")} ${retired.length === 1 ? "is" : "are"} set but no longer used. Add repos at http://localhost:3000/repos instead, and remove ${retired.length === 1 ? "it" : "them"} from .env.local.`,
		);
	}

	const operatorRow = await prisma.user.upsert({
		where: { email: OPERATOR_EMAIL },
		create: { email: OPERATOR_EMAIL, role: "operator" },
		update: {},
	});
	console.log(`operator: ${operatorRow.email} (${operatorRow.role})`);

	const repoRows = await prisma.repo.findMany({
		where: { archivedAt: null },
		orderBy: { slug: "asc" },
	});
	if (repoRows.length === 0) {
		console.log(
			"\nno repos registered yet. Start the console with `pnpm dev` and add one at http://localhost:3000/repos.",
		);
		return;
	}

	for (const repoRow of repoRows) {
		const sync = await syncRegistry(repoRow.slug);
		console.log(`\nregistry sync for ${repoRow.slug}:`);
		console.log(
			`  active:       ${sync.upserted.length > 0 ? sync.upserted.join(", ") : "none"}`,
		);
		console.log(
			`  orphaned:     ${sync.orphaned.length > 0 ? sync.orphaned.join(", ") : "none"}`,
		);
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
