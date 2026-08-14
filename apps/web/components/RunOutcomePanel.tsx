/**
 * Purpose: the parsed result of a run, shown as labelled fields with the reason
 * code as the prominent value. This is the record every chart and every weekly
 * rollup is built from, so it is rendered as data, not as prose.
 *
 * `outcome: "unparsed"` is styled as a failure on purpose. It means the agent's
 * OutcomeSpec matched nothing in the transcript — the run may well have done its
 * job, but as far as Arnold is concerned nothing happened, and that must not look
 * like a neutral third result next to "succeeded" and "rejected".
 */

import { Chip } from "@heroui/react";
import { CircleHelp, ScrollText, TriangleAlert } from "lucide-react";
import { ReasonCodeChip } from "@/components/badges";
import { humanizeCode } from "@/components/format";
import type { AgentSummary, RunOutcome, RunStatus } from "@/components/types";

export function RunOutcomePanel({
	runOutcomePanelOutcomes,
	runOutcomePanelAgent,
	runOutcomePanelStatus,
}: {
	runOutcomePanelOutcomes: RunOutcome[];
	runOutcomePanelAgent: AgentSummary;
	runOutcomePanelStatus: RunStatus;
}) {
	const outcomes = runOutcomePanelOutcomes;
	const spec = runOutcomePanelAgent.outcome;

	return (
		<section className="rounded-large border border-default-200 bg-content1">
			<header className="flex items-center justify-between border-b border-divider px-4 py-2.5">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<ScrollText className="h-4 w-4 text-default-400" />
					Outcome
				</h2>
				{spec ? (
					<span className="font-mono text-[10px] text-default-400">
						{spec.kind === "report"
							? `report · ${spec.pathGlob || "final message"}`
							: spec.kind === "jsonl"
								? `jsonl · ${spec.path}`
								: "json-block"}
					</span>
				) : undefined}
			</header>

			<div className="flex flex-col divide-y divide-divider">
				{outcomes.length === 0 ? (
					<div className="flex items-start gap-2 px-4 py-4 text-xs text-default-500">
						<CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-default-400" />
						<span>
							{runOutcomePanelStatus === "running" ||
							runOutcomePanelStatus === "queued"
								? "No outcome yet. It is parsed when the run ends."
								: "This run produced no outcome record. Nothing will appear for it in a rollup."}
						</span>
					</div>
				) : undefined}

				{outcomes.map((outcome, index) => {
					const unparsed = outcome.outcome === "unparsed";
					return (
						<div
							key={`${outcome.outcome}-${outcome.reasonCode ?? ""}-${index}`}
							className={`px-4 py-3 ${unparsed ? "arnold-unenforced" : ""}`}
						>
							<dl className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-8">
								<div className="flex min-w-0 flex-col gap-1">
									<dt className="text-[10px] uppercase tracking-wider text-default-400">
										Outcome
									</dt>
									<dd className="flex items-center gap-2">
										{unparsed ? (
											<Chip
												color="danger"
												variant="solid"
												size="md"
												startContent={
													<TriangleAlert className="h-3.5 w-3.5" />
												}
												classNames={{
													content: "font-mono text-xs font-semibold",
												}}
											>
												unparsed
											</Chip>
										) : (
											<span className="font-mono text-sm font-semibold text-foreground">
												{outcome.outcome}
											</span>
										)}
									</dd>
								</div>

								<div className="flex min-w-0 flex-col gap-1">
									<dt className="text-[10px] uppercase tracking-wider text-default-400">
										Reason code
									</dt>
									<dd>
										{outcome.reasonCode ? (
											<ReasonCodeChip
												reasonCode={outcome.reasonCode}
												reasonCodeSize="md"
												reasonCodeEmphasis
											/>
										) : (
											<span className="text-xs text-default-400">none</span>
										)}
									</dd>
								</div>

								{outcome.reasonCode ? (
									<div className="flex min-w-0 flex-col gap-1">
										<dt className="text-[10px] uppercase tracking-wider text-default-400">
											Reads as
										</dt>
										<dd className="text-xs text-default-600">
											{humanizeCode(outcome.reasonCode)}
										</dd>
									</div>
								) : undefined}
							</dl>

							{unparsed ? (
								<p className="mt-3 text-xs text-danger-500">
									The outcome spec did not match this run. Until it does, this run
									contributes nothing to any rollup — check the verdict pattern in
									the manifest against what the agent actually printed.
								</p>
							) : undefined}
						</div>
					);
				})}
			</div>

			{runOutcomePanelAgent.reasonCodes.length > 0 ? (
				<footer className="flex flex-wrap items-center gap-1.5 border-t border-divider px-4 py-2.5">
					<span className="text-[10px] uppercase tracking-wider text-default-400">
						Vocabulary
					</span>
					{runOutcomePanelAgent.reasonCodes.map((code) => {
						const emitted = outcomes.some((outcome) => outcome.reasonCode === code);
						return (
							<Chip
								key={code}
								size="sm"
								variant={emitted ? "solid" : "bordered"}
								color={emitted ? "warning" : "default"}
								classNames={{
									content: `font-mono text-[10px] ${emitted ? "" : "text-default-400"}`,
								}}
							>
								{code}
							</Chip>
						);
					})}
				</footer>
			) : undefined}
		</section>
	);
}
