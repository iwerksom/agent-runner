/**
 * Purpose: in-process fan-out from the Runner to any SSE stream watching a run.
 *
 * Phase 1 replaces this file with Redis pub/sub and nothing else changes, so the
 * surface is deliberately three functions and one message union. Do not add
 * request/response, replay, or filtering here: replay comes from the RunEvent
 * table, which is the durable record. The bus is a live tap, and a dropped
 * message is acceptable because a reconnecting client re-reads the table.
 *
 * The emitter lives on `globalThis` for the same reason the Prisma client does:
 * Next re-evaluates modules on hot reload, and a second emitter would leave the
 * web tier subscribed to one instance while the Runner published to the other.
 */

import { EventEmitter } from "node:events";

const ARNOLD_BUS_KEY = "__arnoldRunBus__";

type BusGlobal = typeof globalThis & { [ARNOLD_BUS_KEY]?: EventEmitter };

const busGlobal = globalThis as BusGlobal;

function createBus(): EventEmitter {
	const emitter = new EventEmitter();
	// One listener per open SSE connection per run, and a busy console can have
	// many. The default of 10 would print spurious leak warnings.
	emitter.setMaxListeners(1000);
	return emitter;
}

const runBus: EventEmitter = busGlobal[ARNOLD_BUS_KEY] ?? createBus();
busGlobal[ARNOLD_BUS_KEY] = runBus;

/**
 * One transcript line on the wire. The keys are the RunEvent column names rather
 * than domain-prefixed ones on purpose: this is a serialised row, and the SSE
 * route on the other side normalises the row shape it already reads from the
 * table. Renaming them here would mean the live tap and the replay disagreed.
 */
export type RunBusEvent = {
	/** Ordering for replay. Matches RunEvent.seq. */
	seq: number;
	/** assistant | user | tool_use | tool_result | result | log | question | system */
	type: string;
	/** The SDK message or a synthesised log line, already plain JSON. */
	payload: unknown;
	/** ISO timestamp. */
	at: string;
	/** RunEvent.id, when the row has already been written. */
	id?: string;
};

/** Everything a run subscriber can receive. Discriminated by `busKind`. */
export type RunBusMessage =
	| { busKind: "event"; runId: string; event: RunBusEvent }
	| { busKind: "status"; runId: string; status: string };

export type RunBusListener = (message: RunBusMessage) => void;

/** Channel per run, so a listener is never woken by an unrelated run. */
function channelFor(runId: string): string {
	return `run:${runId}`;
}

export function publishRunEvent(runId: string, event: RunBusEvent): void {
	const message: RunBusMessage = { busKind: "event", runId, event };
	runBus.emit(channelFor(runId), message);
}

export function publishRunStatus(runId: string, status: string): void {
	const message: RunBusMessage = { busKind: "status", runId, status };
	runBus.emit(channelFor(runId), message);
}

/** Returns the unsubscribe function; callers must invoke it on disconnect. */
export function subscribeRun(runId: string, listener: RunBusListener): () => void {
	const channel = channelFor(runId);
	runBus.on(channel, listener);
	return () => {
		runBus.off(channel, listener);
	};
}
