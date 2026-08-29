/**
 * Purpose: one agent as a card in the grid. Answers the four questions an
 * operator asks before pressing Run: what can it change (write scope), is that
 * actually enforced, can it run headless, and what has it cost lately.
 *
 * An `unregistered` agent renders deliberately incomplete — a hatched slot where
 * its badges would be — because a prompt file with no manifest overlay has no
 * tool policy and no write scope, and drawing a neutral "read-only" chip there
 * would be a lie.
 *
 * Client component: it owns the trigger modal's open state, which is UI-local
 * and belongs in the consuming component rather than in any provider.
 */

"use client";

import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Tooltip } from "@heroui/react";
import { ArrowRight, GitFork, Play, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
	AgentStateChip,
	ExecutionModeBadge,
	KindChip,
	RunStatusChip,
	ScopeEnforcementBadge,
	UntrustedInputBadge,
	WriteScopeBadge,
} from "@/components/badges";
import { RelativeTime } from "@/components/RelativeTime";
import { TriggerRunModal } from "@/components/TriggerRunModal";
import { formatCostUsd } from "@/components/format";
import type { AgentSummary } from "@/components/types";

export function AgentCard({
	agentCardAgent,
	agentCardRepoSlug,
}: {
	agentCardAgent: AgentSummary;
	agentCardRepoSlug: string;
}) {
	const agent = agentCardAgent;
	const [agentCardModalOpen, setAgentCardModalOpen] = useState(false);

	const unregistered = agent.state === "unregistered";
	const runButtonDisabled = !agent.runnable || unregistered;
	const runButtonReason =
		agent.notRunnableReason ??
		(unregistered ? "Needs a tool policy and write scope before it can run." : undefined);

	return (
		<>
			<Card
				shadow="none"
				className={`h-full border ${
					unregistered ? "border-dashed border-warning-400" : "border-default-200"
				} bg-content1`}
			>
				<CardHeader className="flex flex-col items-start gap-2 pb-2">
					<div className="flex w-full items-start justify-between gap-2">
						<Link
							href={`/agents/${agent.id}`}
							className="group flex items-center gap-1.5 text-base font-semibold leading-tight text-foreground hover:text-primary"
						>
							{agent.name}
							<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
						</Link>
						<KindChip agentKind={agent.kind} />
					</div>
					<code className="font-mono text-[11px] text-default-400">{agent.id}</code>
				</CardHeader>

				<CardBody className="flex flex-col gap-3 pt-0">
					<p className="line-clamp-3 text-sm text-default-500">{agent.description}</p>

					{unregistered ? (
						<div className="arnold-unenforced flex items-start gap-2 rounded-medium border border-dashed border-warning-400 p-2.5">
							<TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
							<div className="flex flex-col gap-1">
								<span className="text-xs font-semibold text-warning-600">
									Needs a tool policy and write scope
								</span>
								<span className="text-[11px] text-default-500">
									The prompt file exists in the repo, but no manifest overlay
									declares what it may change. Arnold will not run it.
								</span>
							</div>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-1.5">
							<WriteScopeBadge writeScope={agent.writeScope} />
							<ExecutionModeBadge executionMode={agent.execution} />
							<ScopeEnforcementBadge scopeEnforcement={agent.scopeEnforcement} />
						</div>
					)}

					<div className="flex flex-wrap items-center gap-1.5">
						{agent.state !== "active" ? (
							<AgentStateChip agentState={agent.state} />
						) : undefined}
						{agent.ingestsUntrustedInput ? <UntrustedInputBadge /> : undefined}
						{agent.invocable === "child" ? (
							<Chip size="sm" variant="bordered" classNames={{ content: "text-xs" }}>
								child-only
							</Chip>
						) : undefined}
						{agent.spawnsSubagents.length > 0 ? (
							<Tooltip
								content={`Spawns: ${agent.spawnsSubagents.join(", ")}`}
								delay={200}
							>
								<span className="inline-flex">
									<Chip
										size="sm"
										variant="bordered"
										startContent={<GitFork className="h-3.5 w-3.5" />}
										classNames={{ content: "text-xs" }}
									>
										{agent.spawnsSubagents.length} subagent
										{agent.spawnsSubagents.length === 1 ? "" : "s"}
									</Chip>
								</span>
							</Tooltip>
						) : undefined}
						{agent.mainBookkeeping ? (
							<Tooltip
								content={`Commits its own state to the default branch: ${agent.mainBookkeeping.paths.join(", ")}`}
								delay={200}
								className="max-w-xs"
							>
								<span className="inline-flex">
									<Chip
										size="sm"
										variant="bordered"
										color="warning"
										classNames={{ content: "text-xs" }}
									>
										main bookkeeping
									</Chip>
								</span>
							</Tooltip>
						) : undefined}
					</div>

					<div className="flex items-center gap-2 border-t border-divider pt-3 text-xs">
						{agent.lastRun ? (
							<Link
								href={`/runs/${agent.lastRun.id}`}
								className="flex items-center gap-2 hover:opacity-80"
							>
								<RunStatusChip runStatus={agent.lastRun.status} />
								<RelativeTime
									relativeTimeIso={agent.lastRun.createdAt}
									relativeTimeClassName="text-default-400"
								/>
							</Link>
						) : (
							<span className="text-default-400">Never run</span>
						)}
					</div>
				</CardBody>

				<CardFooter className="items-center justify-between gap-2 border-t border-divider pt-3">
					<div className="flex flex-col">
						<span className="font-mono text-sm tabular-nums text-default-700">
							{formatCostUsd(agent.costUsd7d)}
						</span>
						<span className="text-[11px] text-default-400">
							{agent.runCount7d} run{agent.runCount7d === 1 ? "" : "s"} · 7d
						</span>
					</div>

					{runButtonDisabled ? (
						<Tooltip
							content={runButtonReason ?? "Not runnable."}
							delay={150}
							className="max-w-xs"
						>
							{/* A disabled button swallows pointer events, so the tooltip
							    anchors to a wrapper instead. */}
							<span className="inline-flex" tabIndex={0}>
								<Button
									size="sm"
									color="primary"
									variant="flat"
									isDisabled
									startContent={<Play className="h-4 w-4" />}
								>
									Run
								</Button>
							</span>
						</Tooltip>
					) : (
						<Button
							size="sm"
							color="primary"
							startContent={<Play className="h-4 w-4" />}
							onPress={() => setAgentCardModalOpen(true)}
						>
							Run
						</Button>
					)}
				</CardFooter>
			</Card>

			{agentCardModalOpen ? (
				<TriggerRunModal
					triggerRunModalAgent={agent}
					triggerRunModalRepoSlug={agentCardRepoSlug}
					triggerRunModalIsOpen={agentCardModalOpen}
					triggerRunModalOnClose={() => setAgentCardModalOpen(false)}
				/>
			) : undefined}
		</>
	);
}
