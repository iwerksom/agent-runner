/**
 * Purpose: show the question a run is blocked on, and be honest that Arnold
 * cannot answer it yet. A `needs-human` agent can stop mid-run and ask; the run
 * then sits at `awaiting_input` until a later phase adds the reply channel.
 *
 * Stated plainly rather than hidden behind a disabled input, because an operator
 * who thinks they can answer here will sit and wait for a run that is never going
 * to move.
 */

import { MessageCircleQuestion } from "lucide-react";
import { RunStatusChip } from "@/components/badges";
import type { RunStatus } from "@/components/types";

export function PendingQuestionCallout({
	pendingQuestionText,
	pendingQuestionStatus,
}: {
	pendingQuestionText: string;
	pendingQuestionStatus: RunStatus;
}) {
	return (
		<section className="rounded-large border border-warning-400 bg-warning-50/10 p-4">
			<header className="mb-2 flex flex-wrap items-center gap-2">
				<MessageCircleQuestion className="h-4 w-4 text-warning" />
				<h2 className="text-sm font-semibold text-warning-600">The agent is asking</h2>
				<RunStatusChip runStatus={pendingQuestionStatus} />
			</header>

			<blockquote className="border-l-2 border-warning-400 pl-3 text-sm text-foreground">
				{pendingQuestionText}
			</blockquote>

			<p className="mt-3 text-xs text-default-500">
				Answering from the console lands in a later phase. For now the run holds at{" "}
				<span className="font-mono">awaiting_input</span> until it is cancelled, or until it
				hits its wall-clock budget. Nothing is being spent while it waits.
			</p>
		</section>
	);
}
