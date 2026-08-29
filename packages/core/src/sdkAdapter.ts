/**
 * Purpose: the ONLY file that reads fields off an SDK message.
 *
 * @anthropic-ai/claude-agent-sdk ships a very wide SDKMessage union (40+ members
 * at 0.3.228) and its shapes move between releases. Every other module in Arnold
 * goes through the narrow helpers here, so a version bump is a diff to one file
 * rather than an audit of the Runner.
 *
 * Field access is done through unknown-narrowing rather than the SDK's own types
 * on purpose: `SDKAssistantMessage.message` is an `@anthropic-ai/sdk`
 * `BetaMessage`, which is a peer dependency Arnold does not install. Narrowing
 * locally keeps this file honest without pulling that graph in.
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** RunEvent.type values, matching the comment on the schema column. */
export type RunEventType =
	"assistant" | "user" | "tool_use" | "tool_result" | "result" | "log" | "question" | "system";

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringAt(record: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = record?.[key];
	return typeof value === "string" ? value : undefined;
}

function numberAt(record: Record<string, unknown> | undefined, key: string): number | undefined {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The content blocks of an assistant or user message, if it has any. */
function contentBlocksOf(message: SDKMessage): Record<string, unknown>[] {
	const inner = asRecord(asRecord(message)?.["message"]);
	const content = inner?.["content"];
	if (!Array.isArray(content)) return [];
	return content
		.map(asRecord)
		.filter((block): block is Record<string, unknown> => block !== undefined);
}

/** The raw SDK discriminator: "assistant" | "user" | "result" | "system" | ... */
export function messageType(message: SDKMessage): string {
	return stringAt(asRecord(message), "type") ?? "unknown";
}

/** The message subtype, where the SDK carries one (result and system messages). */
export function messageSubtype(message: SDKMessage): string | undefined {
	return stringAt(asRecord(message), "subtype");
}

export function isResultMessage(message: SDKMessage): boolean {
	return messageType(message) === "result";
}

/** True when the run ended in an SDK-reported error rather than a clean result. */
export function isErrorResult(message: SDKMessage): boolean {
	if (!isResultMessage(message)) return false;
	const record = asRecord(message);
	if (record?.["is_error"] === true) return true;
	const subtype = messageSubtype(message);
	return subtype !== undefined && subtype !== "success";
}

/**
 * Map an SDK message onto a RunEvent type. Tool traffic is split out of the
 * assistant/user messages that carry it, because the transcript UI renders a
 * tool call and a paragraph of prose very differently.
 */
export function runEventTypeFor(message: SDKMessage): RunEventType {
	const type = messageType(message);
	if (type === "assistant") {
		return contentBlocksOf(message).some((block) => block["type"] === "tool_use")
			? "tool_use"
			: "assistant";
	}
	if (type === "user") {
		return contentBlocksOf(message).some((block) => block["type"] === "tool_result")
			? "tool_result"
			: "user";
	}
	if (type === "result") return "result";
	if (type === "system") return "system";
	// Everything else in the union (status, retry, hook, task, progress...) is
	// diagnostic noise for Arnold's purposes and is kept as a log line.
	return "log";
}

/**
 * The human-readable text of a message: concatenated text blocks for an
 * assistant turn, `result` for a successful result message, "" for anything else.
 */
export function messageText(message: SDKMessage): string {
	const type = messageType(message);
	if (type === "result") {
		return stringAt(asRecord(message), "result") ?? "";
	}
	if (type !== "assistant" && type !== "user") return "";
	const parts: string[] = [];
	for (const block of contentBlocksOf(message)) {
		if (block["type"] !== "text") continue;
		const text = stringAt(block, "text");
		if (text !== undefined && text !== "") parts.push(text);
	}
	// A user message can also carry a bare string as its content.
	if (parts.length === 0) {
		const inner = asRecord(asRecord(message)?.["message"]);
		const content = inner?.["content"];
		if (typeof content === "string") return content;
	}
	return parts.join("\n");
}

export type ResultUsage = {
	resultCostUsd: number;
	resultTokens: number;
	resultTurns: number;
};

/**
 * Cost, tokens and turns off a result message. `modelUsage` is preferred over
 * `usage`: the SDK documents `usage` as main-loop only, which would undercount
 * any agent that spawns subagents.
 */
export function resultUsage(message: SDKMessage): ResultUsage | undefined {
	if (!isResultMessage(message)) return undefined;
	const record = asRecord(message);
	const resultCostUsd = numberAt(record, "total_cost_usd") ?? 0;
	const resultTurns = numberAt(record, "num_turns") ?? 0;

	let resultTokens = 0;
	const modelUsage = asRecord(record?.["modelUsage"]);
	if (modelUsage !== undefined) {
		for (const perModel of Object.values(modelUsage)) {
			const usageRecord = asRecord(perModel);
			resultTokens +=
				(numberAt(usageRecord, "inputTokens") ?? 0) +
				(numberAt(usageRecord, "outputTokens") ?? 0) +
				(numberAt(usageRecord, "cacheReadInputTokens") ?? 0) +
				(numberAt(usageRecord, "cacheCreationInputTokens") ?? 0);
		}
	}
	if (resultTokens === 0) {
		const usage = asRecord(record?.["usage"]);
		resultTokens =
			(numberAt(usage, "input_tokens") ?? 0) +
			(numberAt(usage, "output_tokens") ?? 0) +
			(numberAt(usage, "cache_read_input_tokens") ?? 0) +
			(numberAt(usage, "cache_creation_input_tokens") ?? 0);
	}

	return { resultCostUsd, resultTokens, resultTurns };
}

/** The SDK throws AbortError (not DOMException) when its controller is aborted. */
export function isAbortError(caught: unknown): boolean {
	if (caught instanceof Error) {
		return caught.name === "AbortError" || /abort/i.test(caught.message);
	}
	return false;
}
