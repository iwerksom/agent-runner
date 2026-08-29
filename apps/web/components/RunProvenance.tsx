/**
 * Purpose: the Notary's receipt for one run. What repo, what commit it started
 * from, what branch it produced, what PR it opened, which tickets it claims to
 * have touched.
 *
 * Deliberately styled as a printed receipt rather than as another card: this is
 * the record an operator quotes when asked "what did the agent actually change,
 * and against what". Every value is monospaced and shown verbatim — the base sha
 * at 7 characters, the way git prints it, so it can be compared by eye against a
 * terminal.
 */

import { Chip } from "@heroui/react";
import { ExternalLink, GitBranch, GitCommitHorizontal, Ticket } from "lucide-react";
import type { ReactNode } from "react";
import { formatAbsolute, shortSha } from "@/components/format";
import type { RunDetail } from "@/components/types";

function ReceiptRow({
	receiptRowLabel,
	children,
}: {
	receiptRowLabel: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
			<span className="w-24 shrink-0 text-[10px] uppercase tracking-wider text-default-400">
				{receiptRowLabel}
			</span>
			<span className="min-w-0 flex-1 font-mono text-xs text-default-700">{children}</span>
		</div>
	);
}

export function RunProvenance({ runProvenanceRun }: { runProvenanceRun: RunDetail }) {
	const run = runProvenanceRun;
	const base = shortSha(run.baseSha);

	return (
		<section className="arnold-receipt rounded-large border border-dashed border-default-300 bg-content1 p-4">
			<header className="mb-2 flex items-center justify-between border-b border-dashed border-default-300 pb-2">
				<h2 className="text-[10px] uppercase tracking-[0.2em] text-default-500">
					Notary · provenance
				</h2>
				<span className="font-mono text-[10px] text-default-400">{run.id}</span>
			</header>

			<div className="divide-y divide-dashed divide-default-200">
				<ReceiptRow receiptRowLabel="Repo">{run.repoSlug ?? "—"}</ReceiptRow>

				<ReceiptRow receiptRowLabel="Base">
					<span className="inline-flex items-center gap-1.5">
						<GitCommitHorizontal className="h-3.5 w-3.5 text-default-400" />
						{run.baseRef ?? "—"}
						{base ? (
							<>
								<span className="text-default-400">@</span>
								<span className="rounded bg-content3 px-1.5 py-0.5 text-[11px] text-foreground">
									{base}
								</span>
							</>
						) : undefined}
					</span>
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Branch">
					{run.branch ? (
						<span className="inline-flex items-center gap-1.5">
							<GitBranch className="h-3.5 w-3.5 text-default-400" />
							{run.branch}
						</span>
					) : (
						<span className="text-default-400">no branch — nothing was pushed</span>
					)}
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Pull request">
					{run.prUrl ? (
						<a
							href={run.prUrl}
							target="_blank"
							rel="noreferrer noopener"
							className="inline-flex items-center gap-1.5 text-primary hover:underline"
						>
							{run.prNumber !== undefined ? `#${run.prNumber}` : run.prUrl}
							<ExternalLink className="h-3.5 w-3.5" />
						</a>
					) : (
						<span className="text-default-400">none</span>
					)}
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Tickets">
					{run.ticketKeys.length > 0 ? (
						<span className="flex flex-wrap gap-1.5">
							{run.ticketKeys.map((ticketKey) => (
								<Chip
									key={ticketKey}
									size="sm"
									variant="flat"
									startContent={<Ticket className="h-3.5 w-3.5" />}
									classNames={{ content: "font-mono text-[11px]" }}
								>
									{ticketKey}
								</Chip>
							))}
						</span>
					) : (
						<span className="text-default-400">none</span>
					)}
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Workspace">
					{run.workspacePath ? (
						<span className="break-all text-default-500">{run.workspacePath}</span>
					) : (
						<span className="text-default-400">released</span>
					)}
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Trigger">
					<span className="inline-flex items-center gap-2">
						{run.trigger}
						{run.parentRunId ? (
							<a
								href={`/runs/${run.parentRunId}`}
								className="text-primary hover:underline"
							>
								child of {run.parentRunId}
							</a>
						) : undefined}
					</span>
				</ReceiptRow>

				<ReceiptRow receiptRowLabel="Recorded">
					<span className="flex flex-col gap-0.5 text-default-500">
						<span>queued {formatAbsolute(run.createdAt)}</span>
						{run.startedAt ? (
							<span>started {formatAbsolute(run.startedAt)}</span>
						) : undefined}
						{run.endedAt ? <span>ended {formatAbsolute(run.endedAt)}</span> : undefined}
					</span>
				</ReceiptRow>

				{run.exitReason ? (
					<ReceiptRow receiptRowLabel="Exit">
						<span className="text-default-600">{run.exitReason}</span>
					</ReceiptRow>
				) : undefined}
			</div>
		</section>
	);
}
