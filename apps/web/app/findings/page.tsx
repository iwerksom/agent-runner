/**
 * Purpose: what agents have found, per repo: open, filed and closed. Each open
 * finding shows the claim, the measured value and the command that measured it,
 * and has a File issue button that creates the GitHub issue.
 *
 * Server component; the state tabs write to the URL so a view is linkable.
 */

import { SearchCheck } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { FileFindingButton } from "@/components/FileFindingButton";
import { fetchFindings, fetchRepos } from "@/components/api";
import { FINDING_STATES } from "@/components/types";
import { resolveRepoSelection } from "@/lib/repoSelection";

export const dynamic = "force-dynamic";

export default async function FindingsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const resolved = await searchParams;
	const rawState = Array.isArray(resolved.state) ? resolved.state[0] : resolved.state;
	const state = (FINDING_STATES as readonly string[]).includes(rawState ?? "")
		? (rawState as (typeof FINDING_STATES)[number])
		: "open";

	const repos = await fetchRepos();
	const { selectedRepo } = await resolveRepoSelection(repos, resolved.repo);
	const repoQuery = selectedRepo ? `&repo=${encodeURIComponent(selectedRepo.slug)}` : "";

	const findings = await fetchFindings({
		state,
		...(selectedRepo ? { repoSlug: selectedRepo.slug } : {}),
	});

	return (
		<div className="flex flex-col gap-5">
			<header className="flex flex-col gap-3">
				<h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
					<SearchCheck className="h-5 w-5 text-default-400" />
					Findings
				</h1>
				<p className="text-sm text-default-500">
					{findings.length} {state} finding{findings.length === 1 ? "" : "s"}
					{selectedRepo ? ` in ${selectedRepo.name}` : ""}. Filing creates an issue on the
					repo&apos;s GitHub tracker and never touches the repo itself.
				</p>
				<div className="flex gap-1">
					{FINDING_STATES.map((tab) => (
						<Link
							key={tab}
							href={`/findings?state=${tab}${repoQuery}`}
							className={`rounded-medium px-3 py-1.5 text-sm capitalize transition-colors ${
								tab === state
									? "bg-content2 font-medium text-foreground"
									: "text-default-500 hover:bg-content2 hover:text-foreground"
							}`}
						>
							{tab}
						</Link>
					))}
				</div>
			</header>

			{findings.length === 0 ? (
				<EmptyState
					emptyStateTitle={`No ${state} findings`}
					emptyStateDescription="Run an agent that reports findings, such as doc-drift, and they appear here."
					emptyStateIcon={<SearchCheck className="h-6 w-6" />}
				/>
			) : (
				<ul className="flex flex-col gap-3">
					{findings.map((finding) => (
						<li
							key={finding.id}
							className="flex flex-col gap-2 rounded-large border border-default-200 bg-content1 p-4"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="flex min-w-0 flex-col gap-1">
									<span className="font-mono text-xs text-default-500">
										{finding.repoSlug} · {finding.file}
										{finding.line === null ? "" : `:${finding.line}`} ·{" "}
										{finding.verdict}
									</span>
									<span className="text-sm font-medium">{finding.claim}</span>
								</div>
								{finding.state === "open" ? (
									<FileFindingButton fileFindingId={finding.id} />
								) : finding.issueUrl ? (
									<a
										href={finding.issueUrl}
										target="_blank"
										rel="noopener noreferrer"
										className="font-mono text-xs text-primary hover:underline"
									>
										#{finding.issueNumber} ↗
									</a>
								) : undefined}
							</div>
							<p className="text-sm text-default-600">
								Measured: <span className="font-mono">{finding.measured}</span>
							</p>
							<p className="text-xs text-default-500">
								Check: <code className="font-mono">{finding.command}</code>
							</p>
							{finding.note ? (
								<p className="text-xs text-default-500">{finding.note}</p>
							) : undefined}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
