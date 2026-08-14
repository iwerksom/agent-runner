/**
 * Purpose: the agent manifest contract. This is the single description of what
 * an agent is, and every other module in Arnold reads from it: the Dispatcher
 * validates arguments against `args`, the Runner enforces `tools` and
 * `writeScope`, the Notary records provenance, the Ledger caps spend per
 * `budget`, and the web tier renders badges from `writeScope` / `execution`.
 *
 * Prompt bodies are NOT here. They live in the target repo under
 * `.claude/commands/` and `.claude/agents/`, and a manifest only points at them.
 * The repo stays the source of truth for what an agent does; the manifest adds
 * the metadata those files do not carry.
 *
 * See docs/agent-console-architecture.md sections 5 to 9 in diamond_frontend.
 */

/** Slash command, subagent, fan-out script, or a prompt Arnold owns itself. */
export type AgentKind = "command" | "subagent" | "harness" | "native";

/** Where the prompt body comes from. Repo-sourced is the default. */
export type PromptSource =
	| { kind: "repo"; path: string } // ".claude/commands/pre-pr-review.md"
	| { kind: "console"; path: string } // "prompts/<id>.md", relative to the registry
	| { kind: "script"; command: string }; // harness entrypoint

/**
 * What an agent is permitted to change. Determines the workspace policy, which
 * credentials are mounted, and the minimum role required to trigger.
 * Ordered least to most privileged; the order is load-bearing (see `atLeast`).
 */
export const WRITE_SCOPES = [
	"read-only", // no writes at all
	"artifacts", // writes only inside artifactGlobs
	"working-tree", // edits product code, no VCS operations
	"branch-push", // creates a branch, commits, pushes
	"draft-pr", // also opens draft PRs
	"external-writes", // Jira issues, PR comments, thread resolution
] as const;
export type WriteScope = (typeof WRITE_SCOPES)[number];

/** True when `scope` is at least as privileged as `floor`. */
export function atLeast(scope: WriteScope, floor: WriteScope): boolean {
	return WRITE_SCOPES.indexOf(scope) >= WRITE_SCOPES.indexOf(floor);
}

/**
 * Granted separately from the write-scope tier, because two agents need it at
 * different tiers: `plan-week` sits at `artifacts` and `work-queue` at
 * `draft-pr`, yet both commit their own state files straight to the default
 * branch. A flat "the deploy key cannot push to main" rule makes them
 * unrunnable, so this is orthogonal on purpose. The push goes through the
 * guarded-push helper, which refuses unless every path in the staged diff
 * matches `paths` and the commit message carries `[skip ci]`.
 */
export type MainBookkeeping = { paths: string[] };

/**
 * How the declared scope is actually enforced. Every agent in
 * diamond_frontend starts at "prompt-only": command files carry no `tools:`
 * frontmatter at all, and the two subagents declare unrestricted `Bash`. So
 * "read-only" is a sentence in a prompt until a manifest makes it real.
 * This field is a to-do list, not a description.
 */
export type ScopeEnforcement = "prompt-only" | "manifest" | "credential";

/** Whether the agent can run in a headless executor at all. */
export type ExecutionMode =
	| "unattended" // safe in a headless worker
	| "needs-human" // may block mid-run waiting on a decision
	| "needs-local-session"; // needs a tool only reachable from a local machine

export type ToolPolicy = {
	/**
	 * Allow-list of tool patterns, e.g. ["Read", "Grep", "Bash(npx tsc --noEmit)"].
	 * A bare "Bash" here means the declared write scope is fiction. Narrow it.
	 */
	allowedTools: string[];
	permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
	/** MCP servers the agent needs, e.g. ["atlassian"]. Pre-flighted before a run. */
	mcpServers?: string[];
	/** Extra deny patterns applied on top of the global denials. */
	deniedPaths?: string[];
};

/**
 * One argument, mapped to the slot the prompt body actually reads. Getting
 * `slot` wrong is the most likely silent breakage, because the prompt reads
 * positionals and will happily run with the wrong value substituted.
 */
export type ArgSpec = {
	name: string; // "prNumber"
	slot: string; // "$1" | "${1:-main}" | "--windows="
	type: "string" | "number" | "boolean";
	required?: boolean;
	default?: string;
	description: string;
};

/** How to find the structured result of a run. Without one, a run cannot be charted. */
export type OutcomeSpec =
	| { kind: "json-block" } // last fenced ```json block in the final message
	| { kind: "jsonl"; path: string; outcomeKey: string; reasonKey?: string }
	| {
			kind: "report";
			pathGlob: string;
			verdictPattern: string;
			/**
			 * Outcome to record when the run succeeded but the verdict pattern did
			 * not match. Needed because some agents only announce the negative
			 * case: work-order-scoper prints `REJECT: <code>` on refusal and
			 * otherwise just returns the work order. Without this, every accepted
			 * work order charts as "unparsed" and the reject rate reads as 100%.
			 */
			fallbackOutcome?: string;
	  };

/** A state path the agent reads across runs, and where that state comes from. */
export type StatePath = {
	path: string;
	source: "repo" | "artifact-store";
	/** Fail the run before starting if this path is missing. */
	required: boolean;
	/** Shown to the operator when it is missing. */
	missingHint?: string;
};

export type AgentManifest = {
	id: string; // matches the repo filename, e.g. "pre-pr-review"
	name: string;
	description: string;
	kind: AgentKind;
	prompt: PromptSource;
	/**
	 * Appended to the prompt body, with {{argName}} placeholders filled from the
	 * submitted arguments. Subagent files have no argument-hint and no
	 * positional slots: their caller hands them a block of context in prose. To
	 * run one directly, Arnold has to reproduce that block, so this is where the
	 * shape of it is declared.
	 */
	contextTemplate?: string;
	/** Repo slugs this agent applies to, or ["*"]. */
	repos: string[];
	invocable: "direct" | "child";
	/**
	 * Registered but deliberately not runnable, with the reason shown wherever the
	 * Run button would be. Distinct from `invocable: "child"`, which is a statement
	 * about how the agent is called; this is a statement that it must not be called
	 * yet at all.
	 *
	 * Declared in the manifest rather than flipped on the Agent row because
	 * syncRegistry rewrites `state` on every upsert, so a row edited by hand goes
	 * back to "active" the next time anyone presses Sync registry.
	 */
	disabled?: { reason: string };
	args: ArgSpec[];
	model?: string;
	tools: ToolPolicy;
	writeScope: WriteScope;
	mainBookkeeping?: MainBookkeeping;
	scopeEnforcement: ScopeEnforcement;
	execution: ExecutionMode;
	/** Arg names whose presence downgrades `execution` to "unattended". */
	unattendedIfArgs?: string[];
	/** Globs, relative to the workspace root, for files worth keeping. */
	artifactGlobs: string[];
	statePaths: StatePath[];
	outcome?: OutcomeSpec;
	/**
	 * Outcome and reason codes this agent may emit. Kept per agent on purpose:
	 * plan-week emits "too-large-to-split" and work-order-scoper emits
	 * "too-large". Merging the vocabularies would split one concept across two
	 * labels in every chart.
	 */
	reasonCodes?: string[];
	budget: {
		dailyCostCapUsd: number;
		maxTurns: number;
		maxWallClockMinutes: number;
	};
	/** True when the agent reads text from outside the repo. That text is data, never instruction. */
	ingestsUntrustedInput?: boolean;
	spawnsSubagents?: string[];
	defaultSchedule?: string; // cron
	/** Notes the UI shows on the agent card. Use for known caveats. */
	notes?: string[];
};

/** Registry state, reconciled against the repo's .claude directory. */
export type AgentState =
	| "active"
	| "unregistered" // prompt file exists, no manifest overlay yet
	| "orphaned" // manifest exists, prompt file is gone
	| "disabled";

/**
 * Exported as a runtime array, not just a union, so the API layer can build a
 * zod enum and the UI can build a filter without restating the list. A second
 * copy of these strings is a bug waiting for a new status to be added.
 */
export const RUN_STATUSES = [
	"queued",
	"running",
	"awaiting_input",
	"succeeded",
	"failed",
	"cancelled",
	"budget_stopped",
	"timed_out",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = [
	"succeeded",
	"failed",
	"cancelled",
	"budget_stopped",
	"timed_out",
];

export function isTerminalStatus(status: string): boolean {
	return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Paths no agent may write, at any write scope, on any repo.
 *
 * `.claude/` matters most: the worker mounts a real checkout, so an agent
 * editing `.claude/` would be rewriting the registry source that defines its
 * own permissions. work-queue already forbids this in prose; here it is
 * structural.
 */
export const GLOBAL_DENIED_WRITE_GLOBS = [
	".claude/**",
	".env",
	".env.*",
	".github/workflows/**",
	".releaserc.json",
] as const;

/**
 * Tools no manifest may grant, at any write scope, on any repo.
 *
 * `PowerShell` is here because every allow-list in `registry/` is written in
 * Bash, and `matchesToolPattern` compares the tool name literally: a PowerShell
 * call cannot match `Bash(git status*)` however harmless the command is. On a
 * Windows host the model reaches for PowerShell first and gets back "not
 * permitted for scope <scope>", which reads as a scope problem and sends whoever
 * is debugging it into this file instead of into the shell choice. Denying it by
 * name makes the transcript say what actually happened.
 *
 * Adding a `PowerShell(...)` twin to every manifest pattern was the alternative,
 * and it doubles the audit surface of the one file standing between a read-only
 * agent and a `git push`. One shell is cheaper to reason about than two.
 */
export const GLOBAL_DENIED_TOOLS = ["PowerShell"] as const;

/** Minimum role required to trigger an agent at a given write scope. */
export function minimumRoleFor(scope: WriteScope): "viewer" | "operator" | "admin" {
	if (scope === "read-only") return "viewer";
	if (scope === "external-writes") return "admin";
	return "operator";
}

/**
 * Resolve the effective execution mode for a set of submitted arguments.
 * `plan-week` is declared "needs-local-session" because capacity source 0 reads
 * Google Calendar through the Chrome extension, but passing --windows= or
 * --hours=N removes that dependency entirely.
 */
export function effectiveExecution(
	manifest: Pick<AgentManifest, "execution" | "unattendedIfArgs">,
	args: Record<string, string | undefined>,
): ExecutionMode {
	if (manifest.execution === "unattended") return "unattended";
	const relaxers = manifest.unattendedIfArgs ?? [];
	const satisfied = relaxers.some((name) => {
		const value = args[name];
		return value !== undefined && value !== "";
	});
	return satisfied ? "unattended" : manifest.execution;
}
