/**
 * Purpose: one run, in full — the screen an operator sits on while an agent works
 * and the screen they come back to when asking what it did. Header and metrics,
 * the Notary's provenance receipt, the transcript (live or replayed), the outcome
 * record, the arguments as dispatched, the run tree, and the artifacts.
 *
 * Server component for everything static; the live half (header status, cancel,
 * transcript) is delegated to RunDetailLive, which owns the single SSE
 * subscription and takes the provenance receipt as a slot so the receipt stays
 * directly under the header.
 */

import { ArrowLeft, Paperclip } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactList } from "@/components/ArtifactList";
import { RunArgsPanel } from "@/components/RunArgsPanel";
import { RunChildren } from "@/components/RunChildren";
import { RunDetailLive } from "@/components/RunDetailLive";
import { RunOutcomePanel } from "@/components/RunOutcomePanel";
import { RunProvenance } from "@/components/RunProvenance";
import { fetchRun } from "@/components/api";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
	const { runId } = await params;
	const run = await fetchRun(runId);
	if (!run) notFound();

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-3">
				<Link
					href="/runs"
					className="flex w-fit items-center gap-1.5 text-xs text-default-400 hover:text-foreground"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					All runs
				</Link>
				{run.parentRunId ? (
					<Link
						href={`/runs/${run.parentRunId}`}
						className="text-xs text-primary hover:underline"
					>
						parent run
					</Link>
				) : undefined}
				<Link
					href={`/agents/${run.agentId}`}
					className="text-xs text-default-400 hover:text-foreground"
				>
					manifest
				</Link>
			</div>

			<RunDetailLive
				runDetailLiveRun={run}
				runDetailLiveProvenanceSlot={<RunProvenance runProvenanceRun={run} />}
			/>

			<RunOutcomePanel
				runOutcomePanelOutcomes={run.outcomes}
				runOutcomePanelAgent={run.agent}
				runOutcomePanelStatus={run.status}
			/>

			<RunArgsPanel runArgsPanelArgs={run.args} runArgsPanelSpecs={run.agent.args} />

			{run.childCount > 0 ? (
				<RunChildren
					runChildrenRuns={run.children}
					runChildrenExpectedCount={run.childCount}
				/>
			) : undefined}

			<section className="flex flex-col gap-3">
				<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider pb-2">
					<h2 className="flex items-center gap-2 text-base font-semibold">
						<Paperclip className="h-4 w-4 text-default-400" />
						Artifacts
						<span className="text-xs font-normal text-default-400">
							{run.artifacts.length} of {run.artifactCount}
						</span>
					</h2>
					{run.agent.artifactGlobs && run.agent.artifactGlobs.length > 0 ? (
						<span className="font-mono text-[11px] text-default-400">
							{run.agent.artifactGlobs.join(" · ")}
						</span>
					) : undefined}
				</header>

				<ArtifactList artifactListArtifacts={run.artifacts} />
			</section>
		</div>
	);
}
