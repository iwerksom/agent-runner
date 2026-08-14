/**
 * Purpose: the live half of the run screen. Owns the one SSE subscription for the
 * page and feeds it to the header (status, cancel affordance) and the transcript,
 * so both agree on the run's state and only one connection is opened.
 *
 * The static half — provenance, children, artifacts, outcome — is rendered on the
 * server and passed in as a slot, because the provenance receipt belongs directly
 * under the header and nothing about it needs to be live.
 *
 * When the stream reports a terminal status the server payload is refreshed once,
 * so the final duration, cost and artifact list come from the database rather
 * than from whatever the last frame happened to carry.
 */

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RunHeader } from "@/components/RunHeader";
import { RunTranscript } from "@/components/RunTranscript";
import { PendingQuestionCallout } from "@/components/PendingQuestionCallout";
import { isTerminalRunStatus, type RunDetail } from "@/components/types";
import { useRunStream } from "@/hooks/useRunStream";

export function RunDetailLive({
	runDetailLiveRun,
	runDetailLiveProvenanceSlot,
}: {
	runDetailLiveRun: RunDetail;
	runDetailLiveProvenanceSlot: ReactNode;
}) {
	const run = runDetailLiveRun;
	const router = useRouter();

	const { runStreamEvents, runStreamStatus, runStreamConnected, runStreamError } = useRunStream({
		runStreamRunId: run.id,
		runStreamInitialEvents: run.events,
		runStreamInitialStatus: run.status,
	});

	const refreshedRef = useRef(isTerminalRunStatus(run.status));
	useEffect(() => {
		if (refreshedRef.current) return;
		if (!isTerminalRunStatus(runStreamStatus)) return;
		refreshedRef.current = true;
		router.refresh();
	}, [router, runStreamStatus]);

	return (
		<div className="flex flex-col gap-5">
			<RunHeader runHeaderRun={run} runHeaderLiveStatus={runStreamStatus} />

			{run.pendingQuestion ? (
				<PendingQuestionCallout
					pendingQuestionText={run.pendingQuestion}
					pendingQuestionStatus={runStreamStatus}
				/>
			) : undefined}

			{runDetailLiveProvenanceSlot}

			<RunTranscript
				runTranscriptEvents={runStreamEvents}
				runTranscriptStatus={runStreamStatus}
				runTranscriptConnected={runStreamConnected}
				runTranscriptStreamError={runStreamError}
			/>
		</div>
	);
}
