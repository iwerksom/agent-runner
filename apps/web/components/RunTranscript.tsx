/**
 * Purpose: render a run's frames. Live while the run is going, replayed once it
 * has finished, from the same list either way — the caller merges the replayed
 * events with the streamed ones (see useRunStream) and hands them here.
 *
 * Presentational on purpose: the SSE subscription lives one level up in
 * RunDetailLive so the header and the transcript share a single connection
 * instead of opening one each.
 *
 * Frame treatment follows what an operator needs at a glance: assistant text is
 * prose, tool_use is a collapsible naming the tool and its input (the input is
 * where a wrongly-mapped argument becomes visible), tool_result is collapsed
 * because it is usually a wall of file contents, and the final result frame is a
 * single summary row with the numbers the Ledger recorded.
 */

"use client";

import { Button, Chip } from "@heroui/react";
import {
	ArrowDownToLine,
	CircleDot,
	FileText,
	Radio,
	SquareTerminal,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import { useMemo } from "react";
import { Markdown } from "@/components/Markdown";
import { formatCostUsd, formatDuration, formatTokens, stringifyPayload } from "@/components/format";
import { isTerminalRunStatus, type RunEventDto, type RunStatus } from "@/components/types";
import { useAutoScroll } from "@/hooks/useAutoScroll";

type FrameKind = "assistant" | "user" | "tool_use" | "tool_result" | "result" | "system";

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Text out of either a bare payload, a { text } payload, or Anthropic content blocks. */
function extractText(payload: unknown): string {
	if (typeof payload === "string") return payload;
	const record = asRecord(payload);

	const direct = asString(record.text) ?? asString(record.content) ?? asString(record.message);
	if (direct !== undefined) return direct;

	const blocks = Array.isArray(record.content)
		? record.content
		: Array.isArray(asRecord(record.message).content)
			? (asRecord(record.message).content as unknown[])
			: undefined;

	if (blocks) {
		return blocks
			.map((block) => {
				const blockRecord = asRecord(block);
				if (blockRecord.type === "text") return asString(blockRecord.text) ?? "";
				return asString(blockRecord.text) ?? "";
			})
			.filter((text) => text.length > 0)
			.join("\n\n");
	}

	return "";
}

function classify(type: string): FrameKind {
	const lower = type.toLowerCase();
	if (lower.includes("tool_use") || lower === "tooluse") return "tool_use";
	if (lower.includes("tool_result") || lower === "toolresult") return "tool_result";
	if (lower === "result" || lower.includes("final")) return "result";
	if (lower.includes("assistant") || lower === "text" || lower === "message") return "assistant";
	if (lower.includes("user") || lower === "prompt") return "user";
	return "system";
}

function Gutter({ gutterSeq, gutterLabel }: { gutterSeq: number; gutterLabel: string }) {
	return (
		<div className="flex w-16 shrink-0 flex-col items-end gap-0.5 pr-3 pt-0.5 text-right">
			<span className="font-mono text-[10px] text-default-300">#{gutterSeq}</span>
			<span className="text-[9px] uppercase tracking-wider text-default-400">
				{gutterLabel}
			</span>
		</div>
	);
}

function ToolFrame({
	toolFrameEvent,
	toolFrameIsResult,
}: {
	toolFrameEvent: RunEventDto;
	toolFrameIsResult: boolean;
}) {
	const record = asRecord(toolFrameEvent.payload);
	const toolName =
		asString(record.name) ??
		asString(record.tool) ??
		asString(record.toolName) ??
		(toolFrameIsResult ? "tool result" : "tool");
	const body = toolFrameIsResult
		? stringifyPayload(record.content ?? record.result ?? record.output ?? record)
		: stringifyPayload(record.input ?? record.args ?? record);
	const isError = record.is_error === true || record.isError === true;
	const preview = body.replace(/\s+/g, " ").slice(0, 110);

	return (
		<details className="group w-full rounded-medium border border-default-200 bg-content2/60">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
				{toolFrameIsResult ? (
					<FileText className="h-3.5 w-3.5 shrink-0 text-default-400" />
				) : (
					<Wrench className="h-3.5 w-3.5 shrink-0 text-primary" />
				)}
				<span className="font-mono text-xs font-medium text-foreground">{toolName}</span>
				{isError ? (
					<Chip
						size="sm"
						color="danger"
						variant="flat"
						classNames={{ content: "text-[10px]" }}
					>
						error
					</Chip>
				) : undefined}
				<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-default-400">
					{preview}
				</span>
				<span className="text-[10px] text-default-400 group-open:hidden">expand</span>
			</summary>
			<pre className="arnold-scroll max-h-80 overflow-auto border-t border-divider px-3 py-2 font-mono text-[11px] leading-relaxed text-default-600">
				{body}
			</pre>
		</details>
	);
}

function ResultFrame({ resultFrameEvent }: { resultFrameEvent: RunEventDto }) {
	const record = asRecord(resultFrameEvent.payload);
	const cost = asNumber(record.costUsd) ?? asNumber(record.total_cost_usd);
	const turns = asNumber(record.numTurns) ?? asNumber(record.num_turns);
	const tokens = asNumber(record.tokens) ?? asNumber(record.total_tokens);
	const duration = asNumber(record.durationMs) ?? asNumber(record.duration_ms);
	const subtype = asString(record.subtype) ?? asString(record.exitReason);
	const text = extractText(record.result ?? record);

	return (
		<div className="w-full rounded-medium border border-primary-200 bg-primary-50/10 px-3 py-2">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
				<span className="flex items-center gap-1.5 font-medium text-primary">
					<CircleDot className="h-3.5 w-3.5" />
					result
				</span>
				{subtype ? (
					<span className="font-mono text-[11px] text-default-500">{subtype}</span>
				) : undefined}
				{cost !== undefined ? (
					<span className="font-mono tabular-nums text-default-600">
						{formatCostUsd(cost)}
					</span>
				) : undefined}
				{tokens !== undefined ? (
					<span className="font-mono tabular-nums text-default-500">
						{formatTokens(tokens)} tok
					</span>
				) : undefined}
				{turns !== undefined ? (
					<span className="font-mono tabular-nums text-default-500">{turns} turns</span>
				) : undefined}
				{duration !== undefined ? (
					<span className="font-mono tabular-nums text-default-500">
						{formatDuration(duration)}
					</span>
				) : undefined}
			</div>
			{text ? (
				<details className="mt-2">
					<summary className="cursor-pointer list-none text-[11px] text-default-400">
						final message
					</summary>
					<div className="mt-2">
						<Markdown markdownSource={text} />
					</div>
				</details>
			) : undefined}
		</div>
	);
}

export function RunTranscript({
	runTranscriptEvents,
	runTranscriptStatus,
	runTranscriptConnected,
	runTranscriptStreamError,
}: {
	runTranscriptEvents: RunEventDto[];
	runTranscriptStatus: RunStatus;
	runTranscriptConnected: boolean;
	runTranscriptStreamError: string | undefined;
}) {
	const live = !isTerminalRunStatus(runTranscriptStatus);
	const { autoScrollRef, autoScrollPinned, autoScrollJumpToLatest } =
		useAutoScroll<HTMLDivElement>({
			autoScrollTrigger: runTranscriptEvents.length,
			autoScrollEnabled: live,
		});

	const frames = useMemo(
		() =>
			runTranscriptEvents.map((event) => ({
				frameEvent: event,
				frameKind: classify(event.type),
			})),
		[runTranscriptEvents],
	);

	return (
		<section className="rounded-large border border-default-200 bg-content1">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-2.5">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<SquareTerminal className="h-4 w-4 text-default-400" />
					Transcript
					<span className="text-xs font-normal text-default-400">
						{frames.length} frame{frames.length === 1 ? "" : "s"}
					</span>
				</h2>

				<div className="flex items-center gap-2">
					{live ? (
						<Chip
							size="sm"
							variant="flat"
							color={runTranscriptConnected ? "primary" : "warning"}
							startContent={<Radio className="h-3.5 w-3.5" />}
							classNames={{ content: "text-[10px]" }}
						>
							{runTranscriptConnected ? "live" : "connecting"}
						</Chip>
					) : (
						<Chip size="sm" variant="flat" classNames={{ content: "text-[10px]" }}>
							replay
						</Chip>
					)}
					{live && !autoScrollPinned ? (
						<Button
							size="sm"
							variant="flat"
							startContent={<ArrowDownToLine className="h-3.5 w-3.5" />}
							onPress={autoScrollJumpToLatest}
						>
							Jump to latest
						</Button>
					) : undefined}
				</div>
			</header>

			{runTranscriptStreamError ? (
				<div className="flex items-center gap-2 border-b border-divider bg-warning-50/10 px-4 py-2 text-xs text-warning-600">
					<TriangleAlert className="h-3.5 w-3.5" />
					{runTranscriptStreamError}
				</div>
			) : undefined}

			<div
				ref={autoScrollRef}
				className="arnold-scroll max-h-[42rem] min-h-[12rem] overflow-y-auto px-4 py-3"
			>
				{frames.length === 0 ? (
					<p className="py-8 text-center text-xs text-default-400">
						{live
							? "Waiting for the first frame…"
							: "This run recorded no transcript events."}
					</p>
				) : undefined}

				<ol className="flex flex-col gap-3">
					{frames.map(({ frameEvent, frameKind }) => (
						<li key={frameEvent.id || `seq-${frameEvent.seq}`} className="flex">
							<Gutter gutterSeq={frameEvent.seq} gutterLabel={frameKind} />

							<div className="min-w-0 flex-1">
								{frameKind === "assistant" ? (
									<Markdown markdownSource={extractText(frameEvent.payload)} />
								) : undefined}

								{frameKind === "user" ? (
									<div className="rounded-medium border border-default-200 bg-content2/60 px-3 py-2 font-mono text-[11px] text-default-500">
										{extractText(frameEvent.payload) ||
											stringifyPayload(frameEvent.payload)}
									</div>
								) : undefined}

								{frameKind === "tool_use" ? (
									<ToolFrame
										toolFrameEvent={frameEvent}
										toolFrameIsResult={false}
									/>
								) : undefined}

								{frameKind === "tool_result" ? (
									<ToolFrame toolFrameEvent={frameEvent} toolFrameIsResult />
								) : undefined}

								{frameKind === "result" ? (
									<ResultFrame resultFrameEvent={frameEvent} />
								) : undefined}

								{frameKind === "system" ? (
									<details className="rounded-medium border border-dashed border-default-200 px-3 py-1.5">
										<summary className="cursor-pointer list-none font-mono text-[11px] text-default-400">
											{frameEvent.type}
										</summary>
										<pre className="arnold-scroll mt-1 max-h-64 overflow-auto font-mono text-[11px] text-default-500">
											{stringifyPayload(frameEvent.payload)}
										</pre>
									</details>
								) : undefined}
							</div>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
