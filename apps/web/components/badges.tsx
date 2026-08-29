"use client";

/*
 * Client component on purpose. HeroUI's Tooltip introspects its child:
 *   if (!isValidElement(children)) trigger = jsx("p", { ...triggerProps, children })
 * Children created in a Server Component are not valid elements at the point
 * Tooltip runs, so it fell back to that <p> wrapper and produced
 * <p><span><div class="chip">, which is invalid HTML and a hydration error.
 * Every prop these badges take is a plain string, so the boundary is cheap.
 */

/**
 * Purpose: the console's badge vocabulary. Every screen labels an agent's
 * privilege and an run's state with these and only these, so a write scope reads
 * the same on a card, in a table row and in a run header.
 *
 * The colour mapping is a policy statement, not decoration:
 *   read-only → default        artifacts → primary
 *   working-tree → secondary   branch-push / draft-pr → warning
 *   external-writes → danger
 * `scopeEnforcement: "prompt-only"` is a warning state, because at that setting
 * the declared write scope is a sentence in a prompt and nothing else.
 */

import { Chip, Tooltip } from "@heroui/react";
import {
	Ban,
	Bot,
	CircleDollarSign,
	CircleHelp,
	Clock,
	Eye,
	FileCode2,
	FileOutput,
	GitBranch,
	GitPullRequestDraft,
	Globe,
	Layers,
	Laptop,
	Loader2,
	MessageCircleQuestion,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	SquareCheckBig,
	Terminal,
	TimerOff,
	TriangleAlert,
	UserCheck,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
	AgentKind,
	AgentState,
	ExecutionMode,
	RunStatus,
	ScopeEnforcement,
	WriteScope,
} from "@/components/types";

type ChipColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";
type ChipSize = "sm" | "md" | "lg";

const ICON = "h-3.5 w-3.5 shrink-0";

function BadgeChip({
	badgeChipColor,
	badgeChipIcon,
	badgeChipLabel,
	badgeChipSize = "sm",
	badgeChipVariant = "flat",
	badgeChipTooltip,
	badgeChipClassName,
}: {
	badgeChipColor: ChipColor;
	badgeChipIcon: ReactNode;
	badgeChipLabel: string;
	badgeChipSize?: ChipSize;
	badgeChipVariant?: "flat" | "solid" | "bordered" | "dot";
	badgeChipTooltip?: string;
	badgeChipClassName?: string;
}) {
	const chip = (
		<Chip
			color={badgeChipColor}
			size={badgeChipSize}
			variant={badgeChipVariant}
			startContent={badgeChipIcon}
			classNames={{
				base: badgeChipClassName,
				content: "font-medium",
			}}
		>
			{badgeChipLabel}
		</Chip>
	);

	if (!badgeChipTooltip) return chip;
	return (
		<Tooltip content={badgeChipTooltip} delay={200} closeDelay={0} className="max-w-xs">
			<span className="inline-flex">{chip}</span>
		</Tooltip>
	);
}

const WRITE_SCOPE_META: Record<WriteScope, { color: ChipColor; icon: ReactNode; tooltip: string }> =
	{
		"read-only": {
			color: "default",
			icon: <Eye className={ICON} />,
			tooltip: "No writes at all. Safe to run against any checkout.",
		},
		artifacts: {
			color: "primary",
			icon: <FileOutput className={ICON} />,
			tooltip: "Writes only inside its declared artifact globs. No product code.",
		},
		"working-tree": {
			color: "secondary",
			icon: <FileCode2 className={ICON} />,
			tooltip: "Edits product code in the leased worktree. No VCS operations.",
		},
		"branch-push": {
			color: "warning",
			icon: <GitBranch className={ICON} />,
			tooltip: "Creates a branch, commits and pushes it.",
		},
		"draft-pr": {
			color: "warning",
			icon: <GitPullRequestDraft className={ICON} />,
			tooltip: "Pushes a branch and opens a draft pull request.",
		},
		"external-writes": {
			color: "danger",
			icon: <Globe className={ICON} />,
			tooltip: "Writes outside the repo: Jira issues, PR comments, thread resolution.",
		},
	};

export function WriteScopeBadge({
	writeScope,
	writeScopeSize = "sm",
}: {
	writeScope: WriteScope;
	writeScopeSize?: ChipSize;
}) {
	const meta = WRITE_SCOPE_META[writeScope];
	return (
		<BadgeChip
			badgeChipColor={meta.color}
			badgeChipIcon={meta.icon}
			badgeChipLabel={writeScope}
			badgeChipSize={writeScopeSize}
			badgeChipTooltip={meta.tooltip}
		/>
	);
}

const EXECUTION_META: Record<ExecutionMode, { color: ChipColor; icon: ReactNode; tip: string }> = {
	unattended: {
		color: "success",
		icon: <Bot className={ICON} />,
		tip: "Safe in a headless worker. Nothing blocks mid-run.",
	},
	"needs-human": {
		color: "warning",
		icon: <UserCheck className={ICON} />,
		tip: "May block mid-run waiting on a decision.",
	},
	"needs-local-session": {
		color: "warning",
		icon: <Laptop className={ICON} />,
		tip: "Needs a tool only reachable from a local machine, so a headless run will fail.",
	},
};

export function ExecutionModeBadge({
	executionMode,
	executionModeSize = "sm",
}: {
	executionMode: ExecutionMode;
	executionModeSize?: ChipSize;
}) {
	const meta = EXECUTION_META[executionMode];
	return (
		<BadgeChip
			badgeChipColor={meta.color}
			badgeChipIcon={meta.icon}
			badgeChipLabel={executionMode}
			badgeChipSize={executionModeSize}
			badgeChipTooltip={meta.tip}
		/>
	);
}

export function ScopeEnforcementBadge({
	scopeEnforcement,
	scopeEnforcementSize = "sm",
}: {
	scopeEnforcement: ScopeEnforcement;
	scopeEnforcementSize?: ChipSize;
}) {
	// prompt-only is deliberately loud: solid warning plus a hatch. The write
	// scope next to it is unenforced, and a flat grey chip would imply otherwise.
	if (scopeEnforcement === "prompt-only") {
		return (
			<BadgeChip
				badgeChipColor="warning"
				badgeChipIcon={<ShieldAlert className={ICON} />}
				badgeChipLabel="prompt-only"
				badgeChipSize={scopeEnforcementSize}
				badgeChipVariant="solid"
				badgeChipTooltip="Unenforced. The write scope is prompt text only: no tool policy restricts this agent yet."
			/>
		);
	}

	if (scopeEnforcement === "manifest") {
		return (
			<BadgeChip
				badgeChipColor="primary"
				badgeChipIcon={<SquareCheckBig className={ICON} />}
				badgeChipLabel="manifest"
				badgeChipSize={scopeEnforcementSize}
				badgeChipTooltip="Enforced by the tool allow-list in this manifest."
			/>
		);
	}

	return (
		<BadgeChip
			badgeChipColor="success"
			badgeChipIcon={<ShieldCheck className={ICON} />}
			badgeChipLabel="credential"
			badgeChipSize={scopeEnforcementSize}
			badgeChipTooltip="Enforced by the credentials mounted into the run, not just by policy."
		/>
	);
}

const STATUS_META: Record<RunStatus, { color: ChipColor; icon: ReactNode; label: string }> = {
	queued: { color: "default", icon: <Clock className={ICON} />, label: "queued" },
	running: {
		color: "primary",
		icon: <Loader2 className={`${ICON} animate-spin`} />,
		label: "running",
	},
	awaiting_input: {
		color: "warning",
		icon: <MessageCircleQuestion className={ICON} />,
		label: "awaiting input",
	},
	succeeded: { color: "success", icon: <SquareCheckBig className={ICON} />, label: "succeeded" },
	failed: { color: "danger", icon: <X className={ICON} />, label: "failed" },
	cancelled: { color: "default", icon: <Ban className={ICON} />, label: "cancelled" },
	budget_stopped: {
		color: "warning",
		icon: <CircleDollarSign className={ICON} />,
		label: "budget stopped",
	},
	timed_out: { color: "warning", icon: <TimerOff className={ICON} />, label: "timed out" },
};

export function RunStatusChip({
	runStatus,
	runStatusSize = "sm",
}: {
	runStatus: RunStatus;
	runStatusSize?: ChipSize;
}) {
	const meta = STATUS_META[runStatus] ?? {
		color: "default" as ChipColor,
		icon: <CircleHelp className={ICON} />,
		label: String(runStatus),
	};
	return (
		<BadgeChip
			badgeChipColor={meta.color}
			badgeChipIcon={meta.icon}
			badgeChipLabel={meta.label}
			badgeChipSize={runStatusSize}
		/>
	);
}

const KIND_META: Record<AgentKind, { icon: ReactNode; tip: string }> = {
	command: {
		icon: <Terminal className={ICON} />,
		tip: "A slash command from the repo's .claude/commands.",
	},
	subagent: {
		icon: <Bot className={ICON} />,
		tip: "A subagent from .claude/agents, normally spawned by a command.",
	},
	harness: {
		icon: <Layers className={ICON} />,
		tip: "A fan-out script that batches child runs.",
	},
	native: { icon: <Sparkles className={ICON} />, tip: "A prompt Arnold owns itself." },
};

export function KindChip({ agentKind }: { agentKind: AgentKind }) {
	const meta = KIND_META[agentKind] ?? {
		icon: <CircleHelp className={ICON} />,
		tip: "Unknown kind.",
	};
	return (
		<BadgeChip
			badgeChipColor="default"
			badgeChipIcon={meta.icon}
			badgeChipLabel={agentKind}
			badgeChipVariant="bordered"
			badgeChipTooltip={meta.tip}
		/>
	);
}

const STATE_META: Record<AgentState, { color: ChipColor; label: string; tip: string }> = {
	active: { color: "success", label: "active", tip: "Registered and reconciled with the repo." },
	unregistered: {
		color: "warning",
		label: "unregistered",
		tip: "The prompt file exists but there is no manifest overlay: no tool policy and no write scope.",
	},
	orphaned: {
		color: "danger",
		label: "orphaned",
		tip: "The manifest exists but its prompt file is gone from the repo.",
	},
	disabled: { color: "default", label: "disabled", tip: "Registered but switched off." },
};

/** Only rendered for states an operator must act on; "active" is the silent default. */
export function AgentStateChip({ agentState }: { agentState: AgentState }) {
	const meta = STATE_META[agentState];
	if (!meta) return undefined;
	return (
		<BadgeChip
			badgeChipColor={meta.color}
			badgeChipIcon={
				agentState === "active" ? (
					<ShieldCheck className={ICON} />
				) : (
					<TriangleAlert className={ICON} />
				)
			}
			badgeChipLabel={meta.label}
			badgeChipVariant={agentState === "active" ? "flat" : "solid"}
			badgeChipTooltip={meta.tip}
		/>
	);
}

/** Reason codes are the vocabulary charts are grouped by, so they are always
 * shown verbatim, never prettified into a sentence. */
export function ReasonCodeChip({
	reasonCode,
	reasonCodeSize = "sm",
	reasonCodeEmphasis = false,
}: {
	reasonCode: string;
	reasonCodeSize?: ChipSize;
	reasonCodeEmphasis?: boolean;
}) {
	return (
		<Chip
			size={reasonCodeSize}
			variant={reasonCodeEmphasis ? "solid" : "flat"}
			color={reasonCodeEmphasis ? "warning" : "default"}
			classNames={{ content: "font-mono text-xs" }}
		>
			{reasonCode}
		</Chip>
	);
}

/** "This agent reads text from outside the repo." Shown wherever an agent's
 * privileges are shown, because untrusted input plus a wide scope is the risk. */
export function UntrustedInputBadge() {
	return (
		<BadgeChip
			badgeChipColor="default"
			badgeChipIcon={<Globe className={ICON} />}
			badgeChipLabel="untrusted input"
			badgeChipVariant="bordered"
			badgeChipTooltip="Reads text from outside the repo (Jira, PR comments). That text is treated as data, never as instruction."
		/>
	);
}
