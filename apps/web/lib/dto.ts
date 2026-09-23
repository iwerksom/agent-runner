/**
 * Purpose: the wire contract between Arnold's API routes and its UI. Every route
 * under app/api returns these shapes, and the UI is coded against exactly these
 * field names, so this file is the one place a rename has to happen.
 *
 * It also holds the mappers that turn Prisma rows into DTOs. Two SQLite facts
 * drive their shape (see packages/core/prisma/schema.prisma):
 *   - enum-ish columns are `String`, so they are narrowed back to the unions
 *     from @arnold/core here at the boundary and nowhere else;
 *   - structured columns are `String` holding JSON, read via core's
 *     `parseJsonColumn` so a malformed row degrades instead of throwing.
 *
 * Row inputs are declared structurally rather than as generated Prisma types:
 * a mapper only needs the columns it reads, which keeps the queries in
 * lib/queries.ts free to select narrowly.
 */

import {
	effectiveExecution,
	parseJsonColumn,
	type AgentKind,
	type AgentManifest,
	type AgentState,
	type ArgSpec,
	type ExecutionMode,
	type MainBookkeeping,
	type OutcomeSpec,
	type PromptSource,
	type RunStatus,
	type ScopeEnforcement,
	type StatePath,
	type ToolPolicy,
	type WriteScope,
} from "@arnold/core";

/* -------------------------------------------------------------------------- */
/* DTOs                                                                       */
/* -------------------------------------------------------------------------- */

export type RunEventDto = {
	id: string;
	seq: number;
	type: string;
	at: string;
	payload: unknown;
};

export type ArtifactDto = {
	id: string;
	kind: string;
	path: string;
	mimeType: string;
	sizeBytes: number;
	createdAt: string;
};

export type RepoDto = {
	id: string;
	slug: string;
	name: string;
	remoteUrl: string;
	localPath?: string;
	defaultBranch: string;
	/** Where registry sync looks for this repo's own prompt files. */
	claudeDir: string;
	agentCount: number;
	runCount: number;
	/** ISO timestamp when the repo was retired, absent while it is active. */
	archivedAt?: string;
};

export type RunOutcomeDto = {
	outcome: string;
	reasonCode?: string;
};

export type RunSummary = {
	id: string;
	agentId: string;
	agentName: string;
	repoSlug?: string;
	status: RunStatus;
	label?: string;
	parentRunId?: string;
	trigger: string;
	args: Record<string, string>;
	createdAt: string;
	startedAt?: string;
	endedAt?: string;
	durationMs?: number;
	costUsd: number;
	tokens: number;
	numTurns: number;
	exitReason?: string;
	branch?: string;
	baseSha?: string;
	prUrl?: string;
	prNumber?: number;
	ticketKeys: string[];
	outcomes: RunOutcomeDto[];
	artifactCount: number;
	childCount: number;
	pendingQuestion?: string;
};

export type AgentSummary = {
	id: string;
	name: string;
	description: string;
	kind: AgentKind;
	state: AgentState;
	invocable: "direct" | "child";
	writeScope: WriteScope;
	execution: ExecutionMode;
	scopeEnforcement: ScopeEnforcement;
	mainBookkeeping?: MainBookkeeping;
	repoSlugs: string[];
	args: ArgSpec[];
	reasonCodes: string[];
	notes: string[];
	budget: {
		dailyCostCapUsd: number;
		maxTurns: number;
		maxWallClockMinutes: number;
	};
	spawnsSubagents: string[];
	ingestsUntrustedInput: boolean;
	runnable: boolean;
	notRunnableReason?: string;
	lastRun?: RunSummary;
	costUsd7d: number;
	runCount7d: number;

	/**
	 * Manifest detail, passed through for the agent detail screen: the tool
	 * allow-list, artifact globs, state paths and outcome spec are the whole
	 * point of that page. Optional because an `unregistered` agent has no
	 * manifest overlay yet, and their absence is exactly what the UI reports.
	 */
	prompt?: PromptSource;
	contextTemplate?: string;
	model?: string;
	tools?: ToolPolicy;
	unattendedIfArgs?: string[];
	artifactGlobs?: string[];
	statePaths?: StatePath[];
	outcome?: OutcomeSpec;
	defaultSchedule?: string;
};

export type RunDetail = RunSummary & {
	agent: AgentSummary;
	events: RunEventDto[];
	artifacts: ArtifactDto[];
	children: RunSummary[];
	workspacePath?: string;
	/** Recorded by the Notary on every lease; previously dropped by this mapper. */
	workspaceId?: string;
	baseRef?: string;
};

/* -------------------------------------------------------------------------- */
/* Row inputs                                                                 */
/* -------------------------------------------------------------------------- */

export type RepoRowForDto = {
	id: string;
	slug: string;
	name: string;
	remoteUrl: string;
	localPath: string | null;
	defaultBranch: string;
	claudeDir: string;
	archivedAt: Date | null;
	_count?: { agents?: number; runs?: number };
};

export type ArtifactRowForDto = {
	id: string;
	kind: string;
	path: string;
	mimeType: string;
	sizeBytes: number;
	createdAt: Date | string;
};

export type RunEventRowForDto = {
	id: string;
	seq: number;
	type: string;
	payload: string | null;
	at?: Date | string | null;
};

export type AgentRowForDto = {
	id: string;
	name: string;
	description: string;
	kind: string;
	state: string;
	invocable: string;
	writeScope: string;
	execution: string;
	scopeEnforcement: string;
	mainBookkeeping: string | null;
	manifest: string | null;
	/** Present when the AgentRepo join is included; absent when it is not. */
	repos?: { repo: { slug: string } }[];
};

export type RunRowForDto = {
	id: string;
	agentId: string;
	agent?: { name: string } | null;
	repoId?: string | null;
	repo?: { slug: string } | null;
	parentRunId: string | null;
	label: string | null;
	status: string;
	trigger: string;
	args: string | null;
	baseRef?: string | null;
	baseSha: string | null;
	workspaceId?: string | null;
	branch: string | null;
	prUrl: string | null;
	prNumber: number | null;
	ticketKeys: string | null;
	startedAt: Date | string | null;
	endedAt: Date | string | null;
	costUsd: number;
	tokens: number;
	numTurns: number;
	exitReason: string | null;
	pendingQuestion: string | null;
	createdAt: Date | string;
	outcomes?: { outcome: string; reasonCode: string | null }[];
	_count?: { artifacts?: number; children?: number };
	/** Only loaded on the detail query; the list query counts instead. */
	artifacts?: ArtifactRowForDto[];
	children?: unknown[];
};

export type RunRowForDetailDto = RunRowForDto & {
	events?: RunEventRowForDto[];
};

/** Per-agent aggregates the DTO carries but a single Agent row cannot supply. */
export type AgentSummaryStats = {
	agentCostUsd7d?: number;
	agentRunCount7d?: number;
	agentLastRun?: RunSummary;
};

/* -------------------------------------------------------------------------- */
/* Internal helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Dates are Date objects under the Prisma SQLite driver, but live SSE frames
 * arrive as ISO strings, so both are accepted on the way in. Everything on the
 * wire is an ISO string.
 */
function toIso(value: Date | string): string {
	return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}

function toIsoOrUndefined(value: Date | string | null | undefined): string | undefined {
	return value === null || value === undefined ? undefined : toIso(value);
}

function toStringRecord(value: unknown): Record<string, string> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (entry === undefined || entry === null) continue;
		result[key] = typeof entry === "string" ? entry : String(entry);
	}
	return result;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

/** Reads a relation count from `_count` first, falling back to a loaded array. */
function relationCount(counted: number | undefined, loaded: unknown[] | undefined): number {
	if (typeof counted === "number") return counted;
	return loaded?.length ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                    */
/* -------------------------------------------------------------------------- */

export function mapRepo(row: RepoRowForDto): RepoDto {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		remoteUrl: row.remoteUrl,
		localPath: row.localPath ?? undefined,
		defaultBranch: row.defaultBranch,
		claudeDir: row.claudeDir,
		agentCount: row._count?.agents ?? 0,
		runCount: row._count?.runs ?? 0,
		...(row.archivedAt === null ? {} : { archivedAt: toIso(row.archivedAt) }),
	};
}

export function mapArtifact(row: ArtifactRowForDto): ArtifactDto {
	return {
		id: row.id,
		kind: row.kind,
		path: row.path,
		mimeType: row.mimeType,
		sizeBytes: row.sizeBytes,
		createdAt: toIso(row.createdAt),
	};
}

/**
 * Builds an event frame from an already-parsed payload. The SSE route needs this
 * for live messages, whose payload is an object rather than the JSON text the
 * column holds.
 */
export function makeRunEventDto(fields: {
	id: string;
	seq: number;
	type: string;
	at?: Date | string | null;
	payload: unknown;
}): RunEventDto {
	return {
		id: fields.id,
		seq: fields.seq,
		type: fields.type,
		at: toIsoOrUndefined(fields.at) ?? new Date().toISOString(),
		payload: fields.payload,
	};
}

export function mapRunEvent(row: RunEventRowForDto): RunEventDto {
	return makeRunEventDto({
		id: row.id,
		seq: row.seq,
		type: row.type,
		at: row.at,
		// Falling back to the raw text keeps a malformed transcript viewable
		// instead of collapsing the whole event to null.
		payload: parseJsonColumn<unknown>(row.payload, row.payload ?? undefined),
	});
}

export function mapRunSummary(row: RunRowForDto): RunSummary {
	const startedAt = toIsoOrUndefined(row.startedAt);
	const endedAt = toIsoOrUndefined(row.endedAt);
	const durationMs =
		row.startedAt && row.endedAt
			? new Date(toIso(row.endedAt)).getTime() - new Date(toIso(row.startedAt)).getTime()
			: undefined;

	return {
		id: row.id,
		agentId: row.agentId,
		// Queries always include the agent; the id is a readable last resort
		// rather than an empty cell in the run table.
		agentName: row.agent?.name ?? row.agentId,
		repoSlug: row.repo?.slug ?? undefined,
		status: row.status as RunStatus,
		label: row.label ?? undefined,
		parentRunId: row.parentRunId ?? undefined,
		trigger: row.trigger,
		args: toStringRecord(parseJsonColumn<unknown>(row.args, {})),
		createdAt: toIso(row.createdAt),
		startedAt,
		endedAt,
		durationMs,
		costUsd: row.costUsd,
		tokens: row.tokens,
		numTurns: row.numTurns,
		exitReason: row.exitReason ?? undefined,
		branch: row.branch ?? undefined,
		baseSha: row.baseSha ?? undefined,
		prUrl: row.prUrl ?? undefined,
		prNumber: row.prNumber ?? undefined,
		ticketKeys: toStringArray(parseJsonColumn<unknown>(row.ticketKeys, [])),
		outcomes: (row.outcomes ?? []).map((outcomeRow) => ({
			outcome: outcomeRow.outcome,
			reasonCode: outcomeRow.reasonCode ?? undefined,
		})),
		artifactCount: relationCount(row._count?.artifacts, row.artifacts),
		childCount: relationCount(row._count?.children, row.children),
		pendingQuestion: row.pendingQuestion ?? undefined,
	};
}

/**
 * Why an agent cannot be triggered from the console, as a sentence the agent
 * card can print verbatim. Returns undefined when it can.
 */
function resolveNotRunnableReason(
	row: AgentRowForDto,
	manifest: Partial<AgentManifest>,
): string | undefined {
	if (row.state !== "active") {
		if (row.state === "unregistered")
			return "No manifest overlay yet, so Arnold cannot run it.";
		if (row.state === "orphaned") return "Its prompt file is gone from the repo.";
		// The manifest's own wording when it has one: "disabled" alone tells an
		// operator nothing about when it will come back.
		if (row.state === "disabled")
			return manifest.disabled?.reason ?? "Disabled in the registry.";
		return `Registry state is "${row.state}".`;
	}
	if (row.invocable === "child") return "Only runs as a child of another agent.";

	const declaredExecution = row.execution as ExecutionMode;
	const relaxers = manifest.unattendedIfArgs ?? [];
	// Ask core whether supplying every relaxing argument would make this
	// unattended, rather than restating that rule in the web tier.
	const bestCaseExecution = effectiveExecution(
		{ execution: declaredExecution, unattendedIfArgs: relaxers },
		Object.fromEntries(relaxers.map((name) => [name, "1"])),
	);
	if (bestCaseExecution !== "unattended") {
		if (bestCaseExecution === "needs-human") {
			return "Blocks mid-run for a human decision, so it cannot run headless.";
		}
		return "Needs a tool only reachable from a local session.";
	}
	return undefined;
}

export function mapAgentSummary(row: AgentRowForDto, stats: AgentSummaryStats = {}): AgentSummary {
	// Orphaned and unregistered agents can carry a thin snapshot, so every read
	// off the manifest is defaulted rather than assumed present.
	const manifest = parseJsonColumn<Partial<AgentManifest>>(row.manifest, {});
	const joinedRepoSlugs = (row.repos ?? []).map((join) => join.repo.slug);
	const notRunnableReason = resolveNotRunnableReason(row, manifest);

	return {
		id: row.id,
		name: row.name,
		description: row.description,
		kind: row.kind as AgentKind,
		state: row.state as AgentState,
		invocable: row.invocable === "child" ? "child" : "direct",
		writeScope: row.writeScope as WriteScope,
		execution: row.execution as ExecutionMode,
		scopeEnforcement: row.scopeEnforcement as ScopeEnforcement,
		mainBookkeeping: parseJsonColumn<MainBookkeeping | undefined>(
			row.mainBookkeeping,
			undefined,
		),
		// The join rows are the registration of record; the manifest's own repo
		// list is the fallback for an agent that never got one (unregistered).
		repoSlugs: joinedRepoSlugs.length > 0 ? joinedRepoSlugs : (manifest.repos ?? []),
		args: manifest.args ?? [],
		reasonCodes: manifest.reasonCodes ?? [],
		notes: manifest.notes ?? [],
		budget: manifest.budget ?? { dailyCostCapUsd: 0, maxTurns: 0, maxWallClockMinutes: 0 },
		spawnsSubagents: manifest.spawnsSubagents ?? [],
		ingestsUntrustedInput: manifest.ingestsUntrustedInput ?? false,
		runnable: notRunnableReason === undefined,
		notRunnableReason,
		lastRun: stats.agentLastRun,
		costUsd7d: stats.agentCostUsd7d ?? 0,
		runCount7d: stats.agentRunCount7d ?? 0,

		// Passed through verbatim from the manifest snapshot. The detail screen
		// renders these; the grid ignores them.
		prompt: manifest.prompt,
		contextTemplate: manifest.contextTemplate,
		model: manifest.model,
		tools: manifest.tools,
		unattendedIfArgs: manifest.unattendedIfArgs,
		artifactGlobs: manifest.artifactGlobs,
		statePaths: manifest.statePaths,
		outcome: manifest.outcome,
		defaultSchedule: manifest.defaultSchedule,
	};
}

export function mapRunDetail(
	row: RunRowForDetailDto,
	relations: {
		agent: AgentSummary;
		children: RunSummary[];
		workspacePath?: string;
	},
): RunDetail {
	return {
		...mapRunSummary(row),
		agent: relations.agent,
		events: (row.events ?? []).map(mapRunEvent),
		artifacts: (row.artifacts ?? []).map(mapArtifact),
		children: relations.children,
		workspacePath: relations.workspacePath,
		...(row.workspaceId === null ? {} : { workspaceId: row.workspaceId }),
		baseRef: row.baseRef ?? undefined,
	};
}
