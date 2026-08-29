/**
 * Purpose: GET /api/runs/[runId]/events. The live transcript, as Server-Sent
 * Events.
 *
 * The contract with the UI is one frame shape per line: `data: <RunEventDto>` for
 * transcript events and `data: {"type":"status","status":"..."}` for status
 * changes. Persisted events are replayed in seq order first, so a client that
 * connects late (or reconnects) sees the whole run, then live events follow.
 *
 * Two details are not cosmetic:
 *   - the keep-alive comment every 15s, because an idle agent turn can outlast a
 *     proxy's read timeout and the connection would be dropped mid-run;
 *   - teardown on both `cancel` and request abort, because a listener left
 *     registered after the client navigates away leaks for the life of the
 *     process.
 */

import { isTerminalStatus, parseJsonColumn, prisma, subscribeRun } from "@arnold/core";
import { makeRunEventDto, mapRunEvent } from "@/lib/dto";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Proxies buffer 15s of silence happily; they do not buffer 15s of comments. */
const KEEP_ALIVE_MS = 15_000;

/**
 * Live messages off `subscribeRun` are normalised rather than trusted: an event
 * may arrive as the row itself or wrapped under `event`, and its payload may
 * already be parsed. Returns the row-ish object, or undefined if this is not an
 * event message.
 */
function asEventRecord(candidate: unknown): Record<string, unknown> | undefined {
	if (typeof candidate !== "object" || candidate === null) return undefined;
	const record = candidate as Record<string, unknown>;
	return typeof record.seq === "number" ? record : undefined;
}

function eventRecordOf(message: Record<string, unknown>): Record<string, unknown> | undefined {
	return asEventRecord(message) ?? asEventRecord(message.event);
}

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
	const { runId } = await params;

	const runRow = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
	if (!runRow) return fail(`No run with id ${runId}`, 404, undefined, "run_not_found");

	const eventRows = await prisma.runEvent.findMany({
		where: { runId },
		orderBy: { seq: "asc" },
	});

	const encoder = new TextEncoder();
	let unsubscribeRunStream: (() => void) | undefined;
	let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
	let streamClosed = false;
	// Assigned by `start`, which always runs before `cancel`.
	let teardownStream: () => void = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const teardown = () => {
				if (streamClosed) return;
				streamClosed = true;
				if (keepAliveTimer !== undefined) clearInterval(keepAliveTimer);
				keepAliveTimer = undefined;
				unsubscribeRunStream?.();
				unsubscribeRunStream = undefined;
				try {
					controller.close();
				} catch {
					// Already closed from the client side; nothing left to do.
				}
			};
			teardownStream = teardown;

			const write = (chunk: string) => {
				if (streamClosed) return;
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// The client vanished between our check and the write.
					teardown();
				}
			};
			const sendFrame = (payload: unknown) => write(`data: ${JSON.stringify(payload)}\n\n`);
			const sendStatus = (status: string) => sendFrame({ type: "status", status });

			// Replay first, tracking the high-water mark so a subscription that
			// replays its own buffer cannot duplicate a frame the client has.
			let lastSentSeq = -1;
			for (const eventRow of eventRows) {
				sendFrame(mapRunEvent(eventRow));
				lastSentSeq = Math.max(lastSentSeq, eventRow.seq);
			}
			sendStatus(runRow.status);

			// A finished run has nothing more to say, so do not register a listener.
			if (isTerminalStatus(runRow.status)) {
				teardown();
				return;
			}

			keepAliveTimer = setInterval(() => write(": ping\n\n"), KEEP_ALIVE_MS);

			unsubscribeRunStream = subscribeRun(runId, (message: unknown) => {
				if (typeof message !== "object" || message === null) return;
				const record = message as Record<string, unknown>;

				const eventRecord = eventRecordOf(record);
				if (eventRecord) {
					const seq = eventRecord.seq as number;
					if (seq <= lastSentSeq) return;
					lastSentSeq = seq;
					sendFrame(
						makeRunEventDto({
							id:
								typeof eventRecord.id === "string"
									? eventRecord.id
									: `${runId}:${seq}`,
							seq,
							type: typeof eventRecord.type === "string" ? eventRecord.type : "log",
							at:
								typeof eventRecord.at === "string" || eventRecord.at instanceof Date
									? eventRecord.at
									: undefined,
							payload:
								typeof eventRecord.payload === "string"
									? // A live payload may still be JSON text; keep the raw
										// string as the fallback so nothing is lost.
										parseJsonColumn<unknown>(
											eventRecord.payload,
											eventRecord.payload,
										)
									: eventRecord.payload,
						}),
					);
					return;
				}

				if (typeof record.status === "string") {
					sendStatus(record.status);
					if (isTerminalStatus(record.status)) teardown();
					return;
				}

				// Forward anything else verbatim: a message type core adds later
				// should reach the client rather than be silently dropped.
				sendFrame(record);
			});

			// `cancel` covers a closed stream; abort covers a dropped request.
			request.signal.addEventListener("abort", teardown);
		},
		cancel() {
			teardownStream();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			// Nginx buffers proxied responses by default, which defeats SSE.
			"X-Accel-Buffering": "no",
		},
	});
}
