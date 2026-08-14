/**
 * Purpose: subscribe to a run's SSE feed and keep an ordered, de-duplicated
 * event list plus the latest status. Each `data:` frame is either a RunEventDto
 * or a `{"type":"status","status":"..."}` marker; both arrive on the default
 * message channel.
 *
 * The stream is opened once per run and closed for good on a terminal status —
 * the server ends the response there, and reconnecting would make EventSource
 * re-poll a finished run forever. A run that was already terminal when the page
 * rendered never opens a socket at all: its events came down with the detail
 * payload.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isTerminalRunStatus, type RunEventDto, type RunStatus } from "@/components/types";

type StatusFrame = { type: "status"; status: RunStatus };

function parseFrame(raw: string): RunEventDto | StatusFrame | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return undefined;

		const candidate = parsed as Record<string, unknown>;
		if (candidate.type === "status" && typeof candidate.status === "string") {
			return { type: "status", status: candidate.status as RunStatus };
		}
		if (typeof candidate.type === "string" && typeof candidate.seq === "number") {
			return {
				id: typeof candidate.id === "string" ? candidate.id : `seq-${candidate.seq}`,
				seq: candidate.seq,
				type: candidate.type,
				at: typeof candidate.at === "string" ? candidate.at : new Date().toISOString(),
				payload: candidate.payload,
			};
		}
		return undefined;
	} catch {
		// A truncated frame is not worth surfacing: the next one supersedes it.
		return undefined;
	}
}

export function useRunStream({
	runStreamRunId,
	runStreamInitialEvents,
	runStreamInitialStatus,
}: {
	runStreamRunId: string;
	runStreamInitialEvents?: RunEventDto[];
	runStreamInitialStatus: RunStatus;
}): {
	runStreamEvents: RunEventDto[];
	runStreamStatus: RunStatus;
	runStreamConnected: boolean;
	runStreamError: string | undefined;
} {
	const [streamFrames, setStreamFrames] = useState<RunEventDto[]>([]);
	const [streamStatus, setStreamStatus] = useState<RunStatus>(runStreamInitialStatus);
	const [streamConnected, setStreamConnected] = useState(false);
	const [streamError, setStreamError] = useState<string | undefined>(undefined);

	// Latched once the run reaches a terminal status, so an EventSource error
	// after a normal end-of-stream cannot reopen the connection.
	const streamDoneRef = useRef(isTerminalRunStatus(runStreamInitialStatus));

	useEffect(() => {
		if (streamDoneRef.current) return;
		if (typeof window === "undefined" || typeof window.EventSource === "undefined") return;

		const source = new EventSource(`/api/runs/${encodeURIComponent(runStreamRunId)}/events`);

		const finish = () => {
			streamDoneRef.current = true;
			setStreamConnected(false);
			source.close();
		};

		source.onopen = () => {
			setStreamConnected(true);
			setStreamError(undefined);
		};

		source.onmessage = (message: MessageEvent<string>) => {
			const frame = parseFrame(message.data);
			if (!frame) return;

			if ("status" in frame && frame.type === "status") {
				setStreamStatus(frame.status);
				if (isTerminalRunStatus(frame.status)) finish();
				return;
			}

			setStreamFrames((previous) => [...previous, frame]);
		};

		source.onerror = () => {
			setStreamConnected(false);
			// EventSource retries by itself while the run is live, so this is only
			// reported, not acted on. A CLOSED socket means it gave up.
			if (source.readyState === EventSource.CLOSED) {
				streamDoneRef.current = true;
				setStreamError("Event stream closed. Reload to resume.");
			} else {
				setStreamError("Event stream interrupted, reconnecting…");
			}
		};

		return () => {
			setStreamConnected(false);
			source.close();
		};
	}, [runStreamRunId]);

	const runStreamEvents = useMemo(() => {
		// The replayed payload and the live stream overlap around the point the
		// page was rendered, so seq is the identity and the last frame wins.
		const bySeq = new Map<number, RunEventDto>();
		const unsequenced: RunEventDto[] = [];

		for (const event of [...(runStreamInitialEvents ?? []), ...streamFrames]) {
			if (typeof event.seq === "number" && Number.isFinite(event.seq)) {
				bySeq.set(event.seq, event);
			} else {
				unsequenced.push(event);
			}
		}

		const ordered = [...bySeq.values()].sort((left, right) => left.seq - right.seq);
		return [...ordered, ...unsequenced];
	}, [runStreamInitialEvents, streamFrames]);

	return {
		runStreamEvents,
		runStreamStatus: streamStatus,
		runStreamConnected: streamConnected,
		runStreamError: streamError,
	};
}
