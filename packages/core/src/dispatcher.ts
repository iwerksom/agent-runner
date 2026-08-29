/**
 * Purpose: the gate every run goes through. Validates that this agent can run,
 * with these arguments, on this repo, within budget — then creates the Run row
 * and starts it.
 *
 * Everything expensive is refused here rather than inside the Runner, because a
 * refusal the operator can act on ("pass --windows= to run headless") is worth
 * more than a failed run with the same message in its transcript.
 */

import { effectiveExecution, type AgentManifest } from "./agents.js";
import { prisma } from "./db.js";
import { BudgetError, ExecutionModeError, NotFoundError, ValidationError } from "./errors.js";
import { stringifyJsonColumn } from "./json.js";
import { checkBudget } from "./ledger.js";
import { validateArgs } from "./prompt.js";
import { getAgentWithManifest } from "./registry.js";
import { runAgent } from "./runner.js";

export type DispatchRunInput = {
	agentId: string;
	repoSlug: string;
	args: Record<string, string | undefined>;
	triggeredById?: string;
};

export type DispatchRunResult = { runId: string };

/** What the operator has to do to make a non-unattended agent runnable. */
function executionModeAdvice(manifest: AgentManifest): string {
	const relaxers = manifest.unattendedIfArgs ?? [];
	const relaxerAdvice =
		relaxers.length === 0
			? "There is no argument that removes the dependency, so it cannot run headless."
			: `Pass one of ${relaxers.map((name) => `--${name}=`).join(" or ")} to run headless.`;
	if (manifest.execution === "needs-local-session") {
		return `${manifest.name} needs a tool only reachable from your machine (for example the Chrome extension). ${relaxerAdvice}`;
	}
	return `${manifest.name} may block mid-run waiting on a human decision. ${relaxerAdvice}`;
}

/**
 * Validate, create the Run row, and start it. Returns as soon as the row exists,
 * so the caller can redirect straight to the run page.
 */
export async function dispatchRun(input: DispatchRunInput): Promise<DispatchRunResult> {
	const { agentId, repoSlug, args, triggeredById } = input;

	const { agentRow, agentManifest } = await getAgentWithManifest(agentId);
	if (agentManifest === undefined) {
		throw new NotFoundError(
			`agent "${agentId}" has no manifest, so it is not runnable. Add a registry entry for it.`,
			{ agentId, agentState: agentRow.state },
		);
	}
	if (agentRow.state !== "active") {
		throw new NotFoundError(
			`agent "${agentId}" is ${agentRow.state}, not active, so it cannot be run.`,
			{ agentId, agentState: agentRow.state },
		);
	}
	if (agentManifest.invocable === "child") {
		throw new ValidationError(
			`agent "${agentId}" is invocable only as a child of another agent; it cannot be dispatched directly.`,
			{ agentId },
		);
	}

	const repoRow = await prisma.repo.findUnique({ where: { slug: repoSlug } });
	if (repoRow === null) {
		throw new NotFoundError(`no repo "${repoSlug}"`, { repoSlug });
	}

	// Throws ValidationError listing what is missing or mistyped.
	const resolvedArgs = validateArgs(agentManifest, args);

	const execution = effectiveExecution(agentManifest, resolvedArgs);
	if (execution !== "unattended") {
		throw new ExecutionModeError(executionModeAdvice(agentManifest), {
			agentId,
			execution,
			unattendedIfArgs: agentManifest.unattendedIfArgs ?? [],
		});
	}

	const budgetCheck = await checkBudget(["global", `agent:${agentId}`], agentManifest.budget);
	if (!budgetCheck.ok) {
		throw new BudgetError(budgetCheck.reason, { agentId });
	}

	const runRow = await prisma.run.create({
		data: {
			agentId,
			repoId: repoRow.id,
			status: "queued",
			trigger: "ui",
			args: stringifyJsonColumn(resolvedArgs),
			baseRef: repoRow.defaultBranch,
			...(triggeredById === undefined ? {} : { triggeredById }),
		},
	});

	// Phase 1 swap point: replace this with a BullMQ enqueue. Nothing else about
	// the Dispatcher changes — the Runner already takes only a runId, so the
	// worker calls the same function. Until then the run executes in the web
	// process, and the rejection is swallowed here because runAgent already
	// writes a terminal status for every failure it can see.
	void runAgent(runRow.id).catch((caught: unknown) => {
		console.error(`[arnold] run ${runRow.id} escaped runAgent's own error handling`, caught);
	});

	return { runId: runRow.id };
}
