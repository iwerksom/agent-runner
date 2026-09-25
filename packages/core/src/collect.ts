/**
 * Purpose: preserve what a run produced after its worktree is handed back, and
 * turn the agent's declared result into a row that can be charted.
 *
 * Two jobs, one lifetime: artifacts (files worth keeping) and outcome (the
 * structured verdict). Both run after the SDK loop finishes and before the
 * workspace is released, because the worktree is reset on the next lease.
 *
 * Outcome parsing never throws. A malformed result is recorded as
 * outcome "unparsed" with the raw text in the payload, because a run whose
 * verdict cannot be read is a fact the operator needs to see, and a thrown error
 * here would turn a completed run into a failed one and lose the transcript.
 */

import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Artifact, RunOutcome } from "@prisma/client";
import fastGlob from "fast-glob";
import type { OutcomeSpec } from "./agents.js";
import { prisma } from "./db.js";
import { stringifyJsonColumn } from "./json.js";
import { artifactRoot } from "./paths.js";

/** Anything bigger is skipped: the artifact store is for reports, not builds. */
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

// Re-exported so existing importers keep working; relative values resolve against
// the repo root rather than the cwd, which differs per entry point. See paths.ts.
export { artifactRoot };

/** Inferred from the path, because the producing agent does not label its files. */
function artifactKindFor(relativePath: string): string {
	const posixPath = relativePath.split(path.sep).join("/");
	if (posixPath.includes(".pr-loop/reports")) return "report";
	if (posixPath.includes(".week-plan/orders")) return "work-order";
	if (posixPath.includes(".week-plan/parked")) return "parked";
	if (posixPath.endsWith(".jsonl")) return "log";
	return "other";
}

const MIME_BY_EXTENSION: Record<string, string> = {
	".md": "text/markdown",
	".markdown": "text/markdown",
	".txt": "text/plain",
	".json": "application/json",
	".jsonl": "application/x-ndjson",
	".ndjson": "application/x-ndjson",
	".csv": "text/csv",
	".tsv": "text/tab-separated-values",
	".html": "text/html",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".log": "text/plain",
	".patch": "text/x-diff",
	".diff": "text/x-diff",
	".yml": "text/yaml",
	".yaml": "text/yaml",
};

function mimeTypeFor(relativePath: string): string {
	return (
		MIME_BY_EXTENSION[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream"
	);
}

/**
 * What the declared globs already matched before the agent ran, so collection can
 * tell the run's own output from the checkout's history. Keyed by the same
 * relative path `collectArtifacts` matches on, valued by mtime.
 */
export type ArtifactBaseline = Map<string, number>;

const ARTIFACT_GLOB_OPTIONS = {
	onlyFiles: true,
	dot: true, // every artifact directory the library agents write is dot-prefixed
	followSymbolicLinks: false,
	unique: true,
} as const;

/**
 * Record the declared globs' existing matches, before the SDK loop starts.
 *
 * Without this, collection sweeps up every file the glob matches in a real
 * checkout, not the ones the run produced: `.pr-loop/reports/PR-*.md` is 51
 * tracked files in the first target repo, so one analyzer run claimed eight reports
 * of which it had written one. That misattributes authorship on the run page and
 * re-copies the repo's history into the store on every run.
 *
 * A snapshot rather than a start-time cutoff, because comparing against a
 * timestamp puts filesystem mtime granularity and the lease's own checkout
 * writes in the way, and a false negative here loses the report the run exists
 * to produce.
 */
export async function snapshotArtifacts(
	workspacePath: string,
	globs: string[],
): Promise<ArtifactBaseline> {
	const baseline: ArtifactBaseline = new Map();
	if (globs.length === 0) return baseline;

	const matches = await fastGlob(globs, { cwd: workspacePath, ...ARTIFACT_GLOB_OPTIONS });
	for (const relativePath of matches) {
		try {
			baseline.set(
				relativePath,
				(await stat(path.join(workspacePath, relativePath))).mtimeMs,
			);
		} catch {
			// Unreadable now means it cannot be a pre-existing file we must exclude;
			// leaving it out of the baseline collects it if it turns up later.
		}
	}
	return baseline;
}

/**
 * Did this run produce this file, or did the checkout arrive carrying it?
 *
 * Pure and exported so the DB-free smoke test can assert it: the DB-backed
 * collector around it cannot run without a Run row, and this is the decision
 * that was silently wrong.
 */
export function isRunAuthoredArtifact(
	baseline: ArtifactBaseline | undefined,
	relativePath: string,
	mtimeMs: number,
): boolean {
	// Unknown baseline, unseen path, or a moved mtime all mean "keep it". Exact
	// equality is deliberate: stat is deterministic for an untouched file, and
	// erring toward collecting loses nothing, while erring the other way would
	// drop the report the run exists to produce.
	return baseline?.get(relativePath) !== mtimeMs;
}

/**
 * Copy every match of `globs` out of the worktree into the artifact store and
 * record a row per file. Returns the rows, so the caller can show them without a
 * second query.
 *
 * `baseline` is what `snapshotArtifacts` saw before the run: a match that is
 * present in it and unmodified is the checkout's, not this run's, and is skipped.
 * Omitting it collects every match, which is only right when nothing is known
 * about the worktree's prior state.
 */
export async function collectArtifacts(
	runId: string,
	workspacePath: string,
	globs: string[],
	baseline?: ArtifactBaseline,
): Promise<Artifact[]> {
	if (globs.length === 0) return [];

	const matches = await fastGlob(globs, { cwd: workspacePath, ...ARTIFACT_GLOB_OPTIONS });
	if (matches.length === 0) return [];

	const destinationDirectory = path.join(artifactRoot(), runId);
	await mkdir(destinationDirectory, { recursive: true });

	const rows: Artifact[] = [];
	const usedFileNames = new Set<string>();

	for (const relativePath of matches.sort()) {
		const absoluteSource = path.join(workspacePath, relativePath);
		let sizeBytes: number;
		let mtimeMs: number;
		try {
			const stats = await stat(absoluteSource);
			sizeBytes = stats.size;
			mtimeMs = stats.mtimeMs;
		} catch (caught: unknown) {
			console.warn(
				`[arnold] artifact ${relativePath} disappeared before collection: ${String(caught)}`,
			);
			continue;
		}
		// Present before the run and untouched by it: the checkout's file, not this
		// run's output. A rewrite moves the mtime and is collected.
		if (!isRunAuthoredArtifact(baseline, relativePath, mtimeMs)) continue;
		if (sizeBytes > MAX_ARTIFACT_BYTES) {
			console.warn(
				`[arnold] skipped artifact ${relativePath} for run ${runId}: ${sizeBytes} bytes exceeds the ${MAX_ARTIFACT_BYTES} byte limit`,
			);
			continue;
		}

		// Two globs can match the same basename in different directories, and the
		// store is flat per run, so collisions get a numeric prefix instead of
		// silently overwriting the earlier file.
		let fileName = path.basename(relativePath);
		if (usedFileNames.has(fileName)) {
			fileName = `${usedFileNames.size + 1}-${fileName}`;
		}
		usedFileNames.add(fileName);

		await copyFile(absoluteSource, path.join(destinationDirectory, fileName));

		rows.push(
			await prisma.artifact.create({
				data: {
					runId,
					kind: artifactKindFor(relativePath),
					path: relativePath.split(path.sep).join("/"),
					// A key, not an absolute path: Phase 1 swaps the root for a
					// bucket and the key stays valid.
					storageKey: `${runId}/${fileName}`,
					mimeType: mimeTypeFor(relativePath),
					sizeBytes,
				},
			}),
		);
	}

	return rows;
}

/** Read a collected artifact back out of the store. */
export async function readArtifact(storageKey: string): Promise<Buffer> {
	return readFile(path.resolve(artifactRoot(), storageKey));
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
	if (record === undefined) return undefined;
	const value = record[key];
	if (typeof value === "string" && value !== "") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

async function createOutcomeRow(
	runId: string,
	outcome: string,
	reasonCode: string | undefined,
	payload: unknown,
): Promise<RunOutcome> {
	return prisma.runOutcome.create({
		data: {
			runId,
			outcome,
			reasonCode: reasonCode ?? null,
			payload: stringifyJsonColumn(payload),
		},
	});
}

/** Last fenced ```json block, which is the one the agent settled on. */
function lastJsonBlock(text: string): string | undefined {
	const fence = /```json\s*\r?\n([\s\S]*?)```/g;
	let last: string | undefined;
	for (;;) {
		const match = fence.exec(text);
		if (match === null) break;
		if (match[1] !== undefined) last = match[1];
	}
	return last;
}

/**
 * A verdict of `hot-files: some-branch` carries both the outcome and its reason,
 * so it splits on the first colon.
 */
function splitVerdict(raw: string): { verdictOutcome: string; verdictReasonCode?: string } {
	const separator = raw.indexOf(":");
	if (separator < 0) return { verdictOutcome: raw.trim() };
	const outcome = raw.slice(0, separator).trim();
	const reason = raw.slice(separator + 1).trim();
	return reason === ""
		? { verdictOutcome: outcome }
		: { verdictOutcome: outcome, verdictReasonCode: reason };
}

/**
 * How a `report` outcome reads its verdict text. Split out pure so the DB-free
 * smoke test can assert it: the branch that matters most has no match to inspect
 * and so leaves no trace to debug from.
 */
export type ReportVerdict =
	| {
			verdictKind: "matched";
			verdictOutcome: string;
			verdictReasonCode?: string;
			verdictRaw: string;
			verdictMatchedText: string;
	  }
	| { verdictKind: "fallback"; verdictOutcome: string }
	| { verdictKind: "unparsed" };

/**
 * Read a verdict out of report text.
 *
 * The load-bearing case is the non-match. Some agents announce only the negative:
 * work-order-scoper prints `REJECT: <code>` when it refuses and otherwise just
 * returns the work order, so no match is the ACCEPTED path, not a parse failure.
 * Without the manifest's `fallbackOutcome` every good work order charts as
 * `unparsed` and the reject rate reads as 100% — a wrong number that looks like a
 * real one. Only a manifest that declares a fallback gets that reading; without
 * one a non-match stays `unparsed`, which is the honest answer.
 */
export function resolveReportVerdict(
	verdictPattern: string,
	fallbackOutcome: string | undefined,
	sourceText: string,
): ReportVerdict {
	// Multiline: the manifests anchor with ^ against a line, not the document.
	const verdictMatch = new RegExp(verdictPattern, "m").exec(sourceText);
	if (verdictMatch === null) {
		return fallbackOutcome === undefined
			? { verdictKind: "unparsed" }
			: { verdictKind: "fallback", verdictOutcome: fallbackOutcome };
	}
	const verdictRaw = verdictMatch[1] ?? verdictMatch[0];
	const { verdictOutcome, verdictReasonCode } = splitVerdict(verdictRaw);
	return {
		verdictKind: "matched",
		verdictOutcome,
		...(verdictReasonCode === undefined ? {} : { verdictReasonCode }),
		verdictRaw,
		verdictMatchedText: verdictMatch[0],
	};
}

async function newestMatchingFile(
	workspacePath: string,
	pathGlob: string,
): Promise<string | undefined> {
	const matches = await fastGlob([pathGlob], {
		cwd: workspacePath,
		onlyFiles: true,
		dot: true,
		followSymbolicLinks: false,
	});
	let newestPath: string | undefined;
	let newestMtimeMs = -1;
	for (const relativePath of matches) {
		try {
			const stats = await stat(path.join(workspacePath, relativePath));
			if (stats.mtimeMs > newestMtimeMs) {
				newestMtimeMs = stats.mtimeMs;
				newestPath = relativePath;
			}
		} catch {
			// Raced with a cleanup; the other matches are still usable.
		}
	}
	return newestPath;
}

/**
 * Read the run's declared result and record it. Returns every row created, which
 * is one row today, so a future fan-out agent can emit several without changing
 * the signature.
 */
export async function parseOutcome(
	runId: string,
	workspacePath: string,
	spec: OutcomeSpec | undefined,
	finalMessageText: string,
): Promise<RunOutcome[]> {
	if (spec === undefined) return [];

	try {
		if (spec.kind === "json-block") {
			const block = lastJsonBlock(finalMessageText);
			if (block === undefined) {
				return [
					await createOutcomeRow(runId, "unparsed", "no-json-block", {
						rawText: finalMessageText,
					}),
				];
			}
			const parsed: unknown = JSON.parse(block);
			const record = toRecord(parsed);
			const outcome = stringField(record, "outcome") ?? "ok";
			const reasonCode =
				stringField(record, "reasonCode") ??
				stringField(record, "reason_code") ??
				stringField(record, "reason");
			return [await createOutcomeRow(runId, outcome, reasonCode, parsed)];
		}

		if (spec.kind === "jsonl") {
			const absolutePath = path.join(workspacePath, spec.path);
			const raw = await readFile(absolutePath, "utf8");
			const lines = raw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter((line) => line !== "");
			const lastLine = lines[lines.length - 1];
			if (lastLine === undefined) {
				return [
					await createOutcomeRow(runId, "unparsed", "empty-jsonl", {
						rawText: "",
						sourcePath: spec.path,
					}),
				];
			}
			const parsed: unknown = JSON.parse(lastLine);
			const record = toRecord(parsed);
			const outcome = stringField(record, spec.outcomeKey) ?? "unparsed";
			const reasonCode =
				spec.reasonKey === undefined ? undefined : stringField(record, spec.reasonKey);
			return [
				await createOutcomeRow(runId, outcome, reasonCode, {
					record: parsed,
					sourcePath: spec.path,
				}),
			];
		}

		// kind === "report": the verdict is a line, either in a file or in the
		// final message when the agent writes no file at all.
		let verdictSourceText = finalMessageText;
		let verdictSourcePath: string | undefined;
		if (spec.pathGlob !== "") {
			verdictSourcePath = await newestMatchingFile(workspacePath, spec.pathGlob);
			if (verdictSourcePath !== undefined) {
				verdictSourceText = await readFile(
					path.join(workspacePath, verdictSourcePath),
					"utf8",
				);
			}
		}
		const verdict = resolveReportVerdict(
			spec.verdictPattern,
			spec.fallbackOutcome,
			verdictSourceText,
		);
		if (verdict.verdictKind === "unparsed") {
			return [
				await createOutcomeRow(runId, "unparsed", "no-verdict-match", {
					rawText: verdictSourceText,
					verdictPattern: spec.verdictPattern,
					sourcePath: verdictSourcePath,
				}),
			];
		}
		if (verdict.verdictKind === "fallback") {
			return [
				await createOutcomeRow(runId, verdict.verdictOutcome, undefined, {
					verdictPattern: spec.verdictPattern,
					sourcePath: verdictSourcePath,
					note: "verdict pattern did not match; recorded the manifest fallbackOutcome",
				}),
			];
		}
		return [
			await createOutcomeRow(runId, verdict.verdictOutcome, verdict.verdictReasonCode, {
				verdictRaw: verdict.verdictRaw,
				matchedText: verdict.verdictMatchedText,
				sourcePath: verdictSourcePath,
			}),
		];
	} catch (caught: unknown) {
		return [
			await createOutcomeRow(runId, "unparsed", "parse-error", {
				rawText: finalMessageText,
				parseError: String(caught),
				outcomeSpec: spec,
			}),
		];
	}
}
