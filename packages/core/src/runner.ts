/**
 * Purpose: run one agent, end to end. Loads the Run, leases a worktree, renders
 * the prompt, drives the SDK query loop, persists every message as a RunEvent,
 * then collects artifacts, parses the outcome, records provenance and spend, and
 * releases the workspace.
 *
 * The one invariant this file exists to hold: a run never stays in "running".
 * Every exit path — success, throw, timeout, cancellation — writes a terminal
 * status, because a run stuck in "running" is invisible to the budget check and
 * pins its workspace forever.
 */

import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { Agent, Repo, Run } from "@prisma/client";
import { isTerminalStatus, type AgentManifest } from "./agents.js";
import { publishRunEvent, publishRunStatus } from "./bus.js";
import { collectArtifacts, parseOutcome, snapshotArtifacts } from "./collect.js";
import { prisma } from "./db.js";
import { errorMessageOf, NotFoundError, ValidationError } from "./errors.js";
import { parseJsonColumn, stringifyJsonColumn } from "./json.js";
import { checkBudget, recordUsage } from "./ledger.js";
import { recordProvenance } from "./notary.js";
import { renderPrompt } from "./prompt.js";
import {
	isAbortError,
	isErrorResult,
	messageText,
	resultUsage,
	runEventTypeFor,
} from "./sdkAdapter.js";
import { buildCanUseTool, intersectToolPatterns } from "./writeScope.js";
import { leaseWorkspace, readBookkeepingPaths, releaseWorkspace } from "./workspace.js";

/** In-flight runs, so `cancelRun` can reach a loop it did not start. */
const ARNOLD_INFLIGHT_KEY = "__arnoldInflightRuns__";

type InflightRun = { abortController: AbortController; cancelRequested: boolean };
type InflightGlobal = typeof globalThis & { [ARNOLD_INFLIGHT_KEY]?: Map<string, InflightRun> };

const inflightGlobal = globalThis as InflightGlobal;
const inflightRuns: Map<string, InflightRun> =
	inflightGlobal[ARNOLD_INFLIGHT_KEY] ?? new Map<string, InflightRun>();
inflightGlobal[ARNOLD_INFLIGHT_KEY] = inflightRuns;

type LoadedRun = Run & { agent: Agent; repo: Repo | null };

async function setRunStatus(
	runId: string,
	status: string,
	extra: Record<string, unknown> = {},
): Promise<void> {
	await prisma.run.update({
		where: { id: runId },
		data: { status, ...extra },
	});
	publishRunStatus(runId, status);
}

/** Persist one transcript line and put it on the bus in the same shape. */
async function appendRunEvent(
	runId: string,
	seq: number,
	type: string,
	payload: unknown,
): Promise<void> {
	const row = await prisma.runEvent.create({
		data: { runId, seq, type, payload: stringifyJsonColumn(payload) },
	});
	// The row's own id goes on the wire so a live frame and its replayed twin are
	// recognisably the same event.
	publishRunEvent(runId, {
		seq,
		type,
		payload,
		at: row.at.toISOString(),
		id: row.id,
	});
}

/**
 * Run the agent behind `runId`. Resolves once a terminal status is written; it
 * never rejects, because the only caller in Phase 0 is a fire-and-forget from the
 * Dispatcher and an unhandled rejection there would take down the web process.
 */
export async function runAgent(runId: string): Promise<void> {
	const run: LoadedRun | null = await prisma.run.findUnique({
		where: { id: runId },
		include: { agent: true, repo: true },
	});
	if (run === null) {
		throw new NotFoundError(`no run "${runId}"`, { runId });
	}

	const manifest = parseJsonColumn<Partial<AgentManifest>>(run.agent.manifest, {});
	let seq = 0;
	let workspaceId: string | undefined;
	let workspacePath: string | undefined;
	const inflight: InflightRun = {
		abortController: new AbortController(),
		cancelRequested: false,
	};
	inflightRuns.set(runId, inflight);
	let wallClockExpired = false;
	let wallClockTimer: NodeJS.Timeout | undefined;

	try {
		if (typeof manifest.id !== "string") {
			throw new ValidationError(
				`agent ${run.agentId} has no usable manifest, so it cannot be run. Sync the registry first.`,
				{ agentId: run.agentId },
			);
		}
		const fullManifest = manifest as AgentManifest;
		if (run.repo === null) {
			throw new ValidationError(`run ${runId} has no repo, so no workspace can be leased`, {
				runId,
			});
		}

		// Pre-flight the budget again: the run may have sat queued while another
		// run spent the day's allowance.
		const budgetCheck = await checkBudget(
			["global", `agent:${run.agentId}`],
			fullManifest.budget,
		);
		if (!budgetCheck.ok) {
			await setRunStatus(runId, "budget_stopped", {
				exitReason: budgetCheck.reason,
				endedAt: new Date(),
			});
			await appendRunEvent(runId, ++seq, "log", { message: budgetCheck.reason });
			return;
		}

		const args = parseJsonColumn<Record<string, string>>(run.args, {});
		const baseRef = run.baseRef ?? run.repo.defaultBranch;
		const lease = await leaseWorkspace({
			repo: run.repo,
			baseRef,
			manifest: fullManifest,
			runId,
		});
		workspaceId = lease.workspaceId;
		workspacePath = lease.workspacePath;

		await setRunStatus(runId, "running", {
			startedAt: new Date(),
			workspaceId: lease.workspaceId,
			baseRef: lease.workspaceBaseRef,
			baseSha: lease.workspaceBaseSha,
		});

		const { promptBody, declaredTools } = await renderPrompt(
			fullManifest,
			args,
			lease.workspacePath,
		);
		const effectiveAllowList = intersectToolPatterns(
			fullManifest.tools.allowedTools,
			declaredTools,
		);
		const canUseTool = buildCanUseTool({
			manifest: fullManifest,
			workspacePath: lease.workspacePath,
			...(declaredTools === undefined ? {} : { declaredTools }),
			// Both are required for the mainBookkeeping gate to do anything: without
			// the default branch every push fails closed, and without the reader the
			// gate cannot see the diff it is supposed to be vetting.
			defaultBranch: run.repo.defaultBranch,
			readBookkeepingPaths,
		});

		// Taken before the loop, so collection can tell this run's files from the
		// ones the checkout already carried. A leased worktree is a real checkout:
		// diamond_frontend tracks 51 files under .pr-loop/reports alone.
		const artifactBaseline = await snapshotArtifacts(
			lease.workspacePath,
			fullManifest.artifactGlobs,
		);

		await appendRunEvent(runId, ++seq, "log", {
			message: `leased ${lease.workspacePath} at ${lease.workspaceBaseSha}`,
			allowedTools: effectiveAllowList,
			declaredTools,
			preexistingArtifactMatches: artifactBaseline.size,
		});

		// Wall clock: the SDK accepts an AbortController, so expiry aborts the
		// query rather than leaving a subprocess running while we stop reading it.
		const wallClockMs = Math.max(1, fullManifest.budget.maxWallClockMinutes) * 60_000;
		wallClockTimer = setTimeout(() => {
			wallClockExpired = true;
			inflight.abortController.abort();
		}, wallClockMs);

		const options: Options = {
			cwd: lease.workspacePath,
			// Which settings files the SDK is allowed to read, and the reason this
			// is not left at its default.
			//
			// Omitting it loads user, project AND local settings. The worktree is a
			// real checkout, so "local" means the target repo's own
			// .claude/settings.local.json — 54 pre-approved permissions in
			// diamond_frontend, including Bash(git push *), Bash(git commit *) and
			// Bash(gh pr *). Those are consulted before canUseTool, so a repo could
			// pre-approve its way straight past the manifest's allow-list, which is
			// the one thing this console exists to prevent.
			//
			// "project" is kept because CLAUDE.md rides on the same switch, and an
			// agent that cannot read the repo's conventions gives worse answers.
			// That still loads .claude/settings.json, whose hooks run outside the
			// tool-permission path entirely — narrow this to [] once Phase 3 mounts
			// credentials per tier and the conventions can be injected another way.
			settingSources: ["project"],
			// The allow-list is passed verbatim, patterns included. Anything the SDK
			// does not pre-approve falls through to canUseTool, which is the real
			// gate. Note it is not the ONLY gate: the SDK approves some read-only
			// commands on its own, so this list is a floor, not a ceiling.
			allowedTools: effectiveAllowList,
			permissionMode: fullManifest.tools.permissionMode,
			maxTurns: fullManifest.budget.maxTurns,
			canUseTool,
			abortController: inflight.abortController,
			...(fullManifest.model === undefined ? {} : { model: fullManifest.model }),
		};

		let assistantText = "";
		let finalMessageText = "";
		let usageCostUsd = 0;
		let usageTokens = 0;
		let usageTurns = 0;
		let resultWasError = false;

		for await (const message of query({ prompt: promptBody, options })) {
			seq += 1;
			const eventType = runEventTypeFor(message);
			await appendRunEvent(runId, seq, eventType, message);

			const text = messageText(message);
			if (text !== "") {
				assistantText += `${text}\n`;
				if (eventType === "assistant") finalMessageText = text;
			}

			const usage = resultUsage(message);
			if (usage !== undefined) {
				usageCostUsd = usage.resultCostUsd;
				usageTokens = usage.resultTokens;
				usageTurns = usage.resultTurns;
				resultWasError = isErrorResult(message);
				// The result message's own text is the agent's final word when it
				// wrote one, which is what outcome parsing wants.
				if (text !== "") finalMessageText = text;
			}
		}

		clearTimeout(wallClockTimer);
		wallClockTimer = undefined;

		// Collected on every exit path below, including a failed result: a report
		// written before the failure is still the most useful thing in the run.
		const artifactRows = await collectArtifacts(
			runId,
			lease.workspacePath,
			fullManifest.artifactGlobs,
			artifactBaseline,
		);
		const outcomeRows = await parseOutcome(
			runId,
			lease.workspacePath,
			fullManifest.outcome,
			finalMessageText,
		);
		// Declared order, so the manifest decides which argument's ticket leads:
		// work-order-scoper lists `ticketKey` before `issueText`, and the pasted
		// issue routinely cites other tickets.
		const declaredArgValues = fullManifest.args
			.map((arg) => args[arg.name])
			.filter((value): value is string => typeof value === "string");
		await recordProvenance(runId, lease.workspacePath, assistantText, declaredArgValues);
		await recordUsage(["global", `agent:${run.agentId}`, `repo:${run.repo.slug}`], {
			cost: usageCostUsd,
			tokens: usageTokens,
		});

		await appendRunEvent(runId, ++seq, "log", {
			message: `collected ${artifactRows.length} artifact(s), recorded ${outcomeRows.length} outcome(s)`,
			costUsd: usageCostUsd,
			tokens: usageTokens,
		});

		if (wallClockExpired) {
			await setRunStatus(runId, "timed_out", {
				endedAt: new Date(),
				costUsd: usageCostUsd,
				tokens: usageTokens,
				numTurns: usageTurns,
				exitReason: `wall clock limit of ${fullManifest.budget.maxWallClockMinutes} minute(s) reached`,
			});
			return;
		}
		if (inflight.cancelRequested) {
			await setRunStatus(runId, "cancelled", {
				endedAt: new Date(),
				costUsd: usageCostUsd,
				tokens: usageTokens,
				numTurns: usageTurns,
				exitReason: "cancelled by operator",
			});
			return;
		}
		await setRunStatus(runId, resultWasError ? "failed" : "succeeded", {
			endedAt: new Date(),
			costUsd: usageCostUsd,
			tokens: usageTokens,
			numTurns: usageTurns,
			exitReason: resultWasError ? "the SDK reported an error result" : null,
		});
	} catch (caught: unknown) {
		const reason = errorMessageOf(caught);
		await appendRunEvent(runId, ++seq, "log", { message: reason, failure: true }).catch(
			(loggingFailure: unknown) => {
				console.error(
					`[arnold] could not persist failure event for ${runId}`,
					loggingFailure,
				);
			},
		);
		// An abort is either the wall clock or the operator; neither is a failure.
		const abortedStatus = wallClockExpired
			? "timed_out"
			: inflight.cancelRequested
				? "cancelled"
				: undefined;
		const status =
			abortedStatus !== undefined && isAbortError(caught) ? abortedStatus : "failed";
		await setRunStatus(runId, status, { endedAt: new Date(), exitReason: reason }).catch(
			(statusFailure: unknown) => {
				console.error(
					`[arnold] could not write terminal status for ${runId}`,
					statusFailure,
				);
			},
		);
	} finally {
		if (wallClockTimer !== undefined) clearTimeout(wallClockTimer);
		inflightRuns.delete(runId);
		if (workspaceId !== undefined) {
			await releaseWorkspace(workspaceId).catch((releaseFailure: unknown) => {
				console.error(
					`[arnold] releasing workspace ${workspaceId} for run ${runId} failed (path ${workspacePath})`,
					releaseFailure,
				);
			});
		}
		// Last resort. If any path above failed to write a terminal status, the run
		// would otherwise sit in "running" forever and pin its budget.
		const finalRow = await prisma.run
			.findUnique({ where: { id: runId }, select: { status: true } })
			.catch(() => null);
		if (finalRow !== null && !isTerminalStatus(finalRow.status)) {
			await setRunStatus(runId, "failed", {
				endedAt: new Date(),
				exitReason: "run ended without writing a terminal status",
			}).catch(() => undefined);
		}
	}
}

/**
 * Ask a run to stop. Aborts the SDK query when the run is in this process;
 * otherwise it just marks the row, which stops a queued run from ever starting.
 */
export async function cancelRun(runId: string): Promise<void> {
	const inflight = inflightRuns.get(runId);
	if (inflight !== undefined) {
		inflight.cancelRequested = true;
		inflight.abortController.abort();
		// The loop's own exit path writes the terminal status, so it can record
		// the usage the run had already accrued.
		return;
	}
	const row = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
	if (row === null || isTerminalStatus(row.status)) return;
	await setRunStatus(runId, "cancelled", {
		endedAt: new Date(),
		exitReason: "cancelled by operator before it started",
	});
}
