/**
 * Purpose: the single type surface the UI imports. The wire shapes come from
 * `@/lib/dto`, which is the API tier's contract and therefore the source of
 * truth; this file re-exports them under the names the components use and adds
 * only what dto.ts does not carry.
 *
 * Two things are added, both deliberately:
 *
 * 1. The manifest sub-types (ToolPolicy, StatePath, OutcomeSpec, PromptSource and
 *    the unions) are declared here rather than imported from @arnold/core. They
 *    are identical string unions and structurally interchangeable, and keeping
 *    them local means a client component never imports the core package — which
 *    would drag server-only code into the browser bundle for the sake of a type.
 *
 * 2. `AgentSummary` is widened with the optional manifest detail the agent screen
 *    renders (tool allow-list, artifact globs, state paths, outcome spec, prompt
 *    source). /api/agents does not return these yet; every field is optional and
 *    the UI prints an explicit "not exposed" line when they are absent, so a thin
 *    payload can never be mistaken for a permissive manifest.
 *
 * Absent values are `undefined`, never `null`.
 */

import type {
	AgentSummary as AgentSummaryDto,
	RunDetail as RunDetailDto,
	RunOutcomeDto,
} from "@/lib/dto";

export type { ArtifactDto, RepoDto, RunEventDto, RunSummary } from "@/lib/dto";

/** dto.ts calls it ArtifactDto; the UI names it for the run it belongs to. */
export type { ArtifactDto as RunArtifactDto } from "@/lib/dto";

export type RunOutcome = RunOutcomeDto;

export type AgentKind = "command" | "subagent" | "harness" | "native";

export type WriteScope =
	"read-only" | "artifacts" | "working-tree" | "branch-push" | "draft-pr" | "external-writes";

export type ScopeEnforcement = "prompt-only" | "manifest" | "credential";

export type ExecutionMode = "unattended" | "needs-human" | "needs-local-session";

export type AgentState = "active" | "unregistered" | "orphaned" | "disabled";

export type RunStatus =
	| "queued"
	| "running"
	| "awaiting_input"
	| "succeeded"
	| "failed"
	| "cancelled"
	| "budget_stopped"
	| "timed_out";

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
	"succeeded",
	"failed",
	"cancelled",
	"budget_stopped",
	"timed_out",
];

/**
 * Mirrors `isTerminalStatus` in @arnold/core. Restated because this runs in the
 * browser on every SSE frame, and core is a server-side package.
 */
export function isTerminalRunStatus(status: string): boolean {
	return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/** Filter order on /runs: lifecycle first, then the ways a run can end. */
export const RUN_STATUSES: readonly RunStatus[] = [
	"queued",
	"running",
	"awaiting_input",
	"succeeded",
	"failed",
	"cancelled",
	"budget_stopped",
	"timed_out",
];

/** One argument, mapped to the slot the prompt body actually reads. */
export type ArgSpec = {
	name: string;
	slot: string;
	type: "string" | "number" | "boolean";
	required?: boolean;
	default?: string;
	description: string;
};

export type ToolPolicy = {
	allowedTools: string[];
	permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
	mcpServers?: string[];
	deniedPaths?: string[];
};

export type StatePath = {
	path: string;
	source: "repo" | "artifact-store";
	required: boolean;
	missingHint?: string;
};

export type OutcomeSpec =
	| { kind: "json-block" }
	| { kind: "jsonl"; path: string; outcomeKey: string; reasonKey?: string }
	| { kind: "report"; pathGlob: string; verdictPattern: string };

export type PromptSource =
	| { kind: "repo"; path: string }
	| { kind: "console"; path: string }
	| { kind: "script"; command: string };

/** Manifest detail the agent screen renders but /api/agents does not send yet. */
export type AgentManifestDetail = {
	tools?: ToolPolicy;
	artifactGlobs?: string[];
	statePaths?: StatePath[];
	outcome?: OutcomeSpec;
	prompt?: PromptSource;
	contextTemplate?: string;
	model?: string;
	defaultSchedule?: string;
	unattendedIfArgs?: string[];
};

export type AgentSummary = AgentSummaryDto & AgentManifestDetail;

/** Same as the wire shape, with the widened agent so the manifest panel can read it. */
export type RunDetail = RunDetailDto & { agent: AgentSummary };

/**
 * Error body from any Arnold route (see lib/http.ts). Declared here rather than
 * imported so client components do not pull next/server into their graph.
 */
export type ApiErrorBody = {
	error: string;
	code?: string;
	details?: unknown;
};

/**
 * What Arnold found when it looked at a candidate checkout, from
 * POST /api/repo-probe. Declared here rather than imported from @arnold/core
 * for the same reason as the manifest sub-types above: the add-repo form is a
 * client component, and a type import is not worth the risk of the core package
 * reaching the browser graph.
 *
 * `blockers` is the field that decides anything. Empty means the path is usable;
 * anything in it is a reason registration will be refused, already phrased for
 * the operator. `warnings` never blocks — a repo with no `.claude` directory is
 * a legitimate target for console-owned prompts.
 */
export type CheckoutProbe = {
	probedPath: string;
	exists: boolean;
	isDirectory: boolean;
	isGitCheckout: boolean;
	detectedBranch?: string;
	detectedRemote?: string;
	claudeDirPresent: boolean;
	blockers: string[];
	warnings: string[];
};

/**
 * What removing a repo would cost, from GET /api/repos/[repoSlug]. Read before
 * the confirmation dialog opens so it can state the consequence rather than ask
 * for a leap of faith.
 */
export type RepoRemovalPlan = {
	slug: string;
	runCount: number;
	agentCount: number;
	workspaceCount: number;
	leasedWorkspaceCount: number;
	canDelete: boolean;
	canArchive: boolean;
	deleteBlockers: string[];
};
