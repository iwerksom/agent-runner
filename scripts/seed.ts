/**
 * Purpose: bring an empty database up to a usable state — one operator. Repos are
 * not seeded: they are added at `/repos`, which works on an empty database, and
 * each repo's agents are synced as it is saved.
 *
 * Idempotent: the one write is an upsert.
 *
 * Run with `pnpm seed` from the repo root.
 */

import { disconnectPrisma, prisma } from "../packages/core/src/index.js";

const OPERATOR_EMAIL = process.env.ARNOLD_OPERATOR_EMAIL ?? "operator@localhost";

/**
 * The variables that used to seed the first repo row. Still read, only to say
 * they no longer do anything: an `.env.local` carrying them from before would
 * otherwise look like configuration that is being honoured.
 */
const RETIRED_VARIABLES = [
	"TARGET_REPO_PATH",
	"TARGET_REPO_REMOTE",
	"TARGET_REPO_SLUG",
	"TARGET_REPO_NAME",
	"TARGET_repoSlug",
];

async function main(): Promise<void> {
	const stillSet = RETIRED_VARIABLES.filter((name) => (process.env[name] ?? "").trim() !== "");
	if (stillSet.length > 0) {
		console.warn(
			`warning: ${stillSet.join(", ")} ${stillSet.length === 1 ? "is set but no longer seeds" : "are set but no longer seed"} a repo. Add repos at /repos in the console, then remove ${stillSet.length === 1 ? "it" : "them"} from .env.local.`,
		);
	}

	const operatorRow = await prisma.user.upsert({
		where: { email: OPERATOR_EMAIL },
		create: { email: OPERATOR_EMAIL, role: "operator" },
		update: {},
	});
	console.log(`operator: ${operatorRow.email} (${operatorRow.role})`);

	const repoCount = await prisma.repo.count();
	if (repoCount === 0) {
		console.log("repos: none yet. Start the console and add one at /repos.");
	} else {
		console.log(`repos: ${repoCount} registered; manage them at /repos.`);
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
