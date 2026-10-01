/**
 * Purpose: TEMPORARY bridge, until ROADMAP Phase 4 (Section 0 step 3, #36).
 * Publishes an accepted work order from a scoper run as a comment on the
 * target repo's GitHub issue, labelled `wo:proposed`.
 *
 * The flow it serves: Arnold scopes, this posts the order, the repo owner
 * approves by swapping the label to `wo:approved`, and the `run-work-orders`
 * Claude Code skill (bridge/run-work-orders/SKILL.md) executes approved orders
 * into draft PRs. GitHub is the queue because it already persists, syncs and
 * shows on the board, which `.week-plan/queue.jsonl` in a leased worktree does
 * not. Delete this file and the skill when `work-queue` runs on the repo.
 *
 * Run: pnpm orders:publish <runId>            (posts)
 *      pnpm orders:publish <runId> --dry-run  (prints the comment, posts nothing)
 */

import { execFileSync } from "node:child_process";
import { disconnectPrisma, prisma } from "../packages/core/src/index.js";

export const ORDER_MARKER = "arnold:work-order";
export const LABELS = {
	proposed: {
		name: "wo:proposed",
		color: "C5DEF5",
		description: "Arnold work order posted, waiting for approval",
	},
	approved: {
		name: "wo:approved",
		color: "0E8A16",
		description: "Work order approved by the owner; Claude Code may execute it",
	},
	inProgress: {
		name: "wo:in-progress",
		color: "FBCA04",
		description: "A Claude Code session is executing the work order",
	},
	prOpen: {
		name: "wo:pr-open",
		color: "5319E7",
		description: "Work order executed; draft PR open",
	},
	parked: {
		name: "wo:parked",
		color: "D93F0B",
		description: "Execution stopped; the reason is in the latest comment",
	},
} as const;

function fail(message: string): never {
	console.error(`publish-order: ${message}`);
	process.exit(1);
}

/** "git@github.com:owner/repo.git" or "https://github.com/owner/repo(.git)" -> "owner/repo". */
function githubRepoOf(remoteUrl: string): string | undefined {
	const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
	return match ? `${match[1]}/${match[2]}` : undefined;
}

function gh(args: string[], input?: string): string {
	return execFileSync("gh", args, {
		encoding: "utf8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

const [runId, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (runId === undefined || runId.startsWith("-"))
	fail("usage: pnpm orders:publish <runId> [--dry-run]");

try {
	const run = await prisma.run.findUnique({
		where: { id: runId },
		include: { repo: true, outcomes: true },
	});
	if (run === null) fail(`no run ${runId}`);
	if (!run.agentId.includes("work-order-scoper"))
		fail(`run ${runId} is ${run.agentId}, not a work-order-scoper run`);
	if (run.status !== "succeeded")
		fail(`run ${runId} is ${run.status}; only a succeeded run has an order`);
	if (!run.outcomes.some((outcome) => outcome.outcome === "accepted")) {
		fail(
			`run ${runId} did not produce an accepted order (outcomes: ${run.outcomes.map((o) => o.outcome).join(", ") || "none"})`,
		);
	}
	if (run.repo === null) fail(`run ${runId} has no repo`);
	const repo = githubRepoOf(run.repo.remoteUrl);
	if (repo === undefined)
		fail(`repo ${run.repo.slug} has no GitHub remote (${run.repo.remoteUrl})`);

	const args = JSON.parse(run.args ?? "{}") as Record<string, string>;
	const issueNumber = /^#?(\d+)$/.exec((args.ticketKey ?? "").trim())?.[1];
	if (issueNumber === undefined)
		fail(`run ${runId} has no GitHub ticket key (got ${JSON.stringify(args.ticketKey)})`);

	const resultEvent = await prisma.runEvent.findFirst({
		where: { runId, type: "result" },
		orderBy: { seq: "desc" },
	});
	const resultText =
		resultEvent === null
			? ""
			: String((JSON.parse(resultEvent.payload) as { result?: unknown }).result ?? "");
	// The order starts at its title. Anything the model said before it is not
	// part of the order and must not reach the executor.
	const start = resultText.search(/^# WO-\d+/m);
	if (start < 0) fail(`run ${runId}'s final message has no "# WO-<n>" order heading`);
	const order = resultText.slice(start).trim();

	const body = [
		`<!-- ${ORDER_MARKER} run=${run.id} base=${run.baseSha ?? "unknown"} -->`,
		`**Arnold work order** from run \`${run.id}\`, scoped against \`${(run.baseSha ?? "unknown").slice(0, 12)}\` on \`${run.baseRef ?? run.repo.defaultBranch}\` ($${(run.costUsd ?? 0).toFixed(2)}, ${run.numTurns ?? "?"} turns).`,
		"",
		`To approve, replace \`${LABELS.proposed.name}\` with \`${LABELS.approved.name}\`. Then ask Claude Code in this repo to run approved work orders. It executes only orders the repo owner approved after this comment was posted, and stops if any file in scope changed since \`${(run.baseSha ?? "").slice(0, 12)}\`.`,
		"",
		"---",
		"",
		order,
		"",
		`<!-- /${ORDER_MARKER} -->`,
	].join("\n");

	if (dryRun) {
		console.log(`would post to ${repo}#${issueNumber}:\n\n${body}`);
	} else {
		for (const label of Object.values(LABELS)) {
			gh([
				"label",
				"create",
				label.name,
				"--repo",
				repo,
				"--color",
				label.color,
				"--description",
				label.description,
				"--force",
			]);
		}
		const url = gh(["issue", "comment", issueNumber, "--repo", repo, "--body-file", "-"], body);
		// A new order replaces any earlier state: an approval given to a previous
		// order must not carry over to this one.
		gh([
			"api",
			"-X",
			"POST",
			`repos/${repo}/issues/${issueNumber}/labels`,
			"-f",
			`labels[]=${LABELS.proposed.name}`,
		]);
		for (const stale of [LABELS.approved, LABELS.parked, LABELS.inProgress]) {
			try {
				gh([
					"api",
					"-X",
					"DELETE",
					`repos/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(stale.name)}`,
				]);
			} catch {
				// Not present, which is the usual case.
			}
		}
		console.log(`posted ${url}\nlabelled ${repo}#${issueNumber} ${LABELS.proposed.name}`);
	}
} finally {
	await disconnectPrisma();
}
