/**
 * Purpose: turn a manifest plus submitted arguments into the exact prompt string
 * the SDK is handed.
 *
 * The prompt body is never stored in Arnold. It is read out of the leased
 * checkout (`prompt.kind === "repo"`) or the registry (`"console"`), so the
 * target repo stays the source of truth for what an agent does. This file only
 * fills the slots the manifest declares.
 *
 * Slots are the highest-risk part of the pipeline: a wrong `slot` substitutes a
 * plausible value into the wrong place and the run completes, silently answering
 * the wrong question. So every form a slot can take is handled explicitly and
 * anything unrecognised is treated as a literal token rather than ignored —
 * `pr-loop-analyzer` really does read `<PR>` instead of `$1`.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AgentManifest, ArgSpec } from "./agents.js";
import { ValidationError } from "./errors.js";
import { repoRoot } from "./paths.js";

/** A prompt file's frontmatter, flattened to top-level scalar lines. */
export type ParsedPromptFile = {
	promptFileBody: string;
	promptFileFrontmatter: Record<string, string>;
};

export type RenderedPrompt = {
	promptBody: string;
	/**
	 * The `tools:` frontmatter line, when the file carries one. The caller
	 * intersects it with the manifest allow-list; narrower wins.
	 */
	declaredTools?: string[];
};

/** `$1` .. `$9` */
const POSITIONAL_SLOT_RE = /^\$(\d)$/;
/** `${1:-main}` — positional with an inline default baked into the prompt. */
const DEFAULTED_SLOT_RE = /^\$\{(\d):-(.*)\}$/;
/** `{{woNumber}}` — filled inside `contextTemplate`, never in the body. */
const TEMPLATE_SLOT_RE = /^\{\{(\w+)\}\}$/;
/** Any `{{name}}` left unfilled after templating. */
const LEFTOVER_TEMPLATE_RE = /\{\{\w+\}\}/g;

type SlotShape =
	| { slotKind: "positional"; slotIndex: string }
	| { slotKind: "defaulted"; slotIndex: string; slotInlineDefault: string }
	| { slotKind: "flag"; slotFlag: string }
	| { slotKind: "template"; slotTemplateName: string }
	| { slotKind: "literal"; slotToken: string };

/** Classify one declared slot. Exported shape stays internal on purpose. */
function classifySlot(slot: string): SlotShape {
	const positional = POSITIONAL_SLOT_RE.exec(slot);
	if (positional?.[1] !== undefined) {
		return { slotKind: "positional", slotIndex: positional[1] };
	}
	const defaulted = DEFAULTED_SLOT_RE.exec(slot);
	if (defaulted?.[1] !== undefined) {
		return {
			slotKind: "defaulted",
			slotIndex: defaulted[1],
			slotInlineDefault: defaulted[2] ?? "",
		};
	}
	if (slot.endsWith("=")) return { slotKind: "flag", slotFlag: slot };
	const template = TEMPLATE_SLOT_RE.exec(slot);
	if (template?.[1] !== undefined) {
		return { slotKind: "template", slotTemplateName: template[1] };
	}
	return { slotKind: "literal", slotToken: slot };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip a leading YAML frontmatter block and flatten its top-level `key: value`
 * lines. Nested structures are skipped rather than parsed: the only keys Arnold
 * reads are `tools` and `argument-hint`, both single-line in practice, and
 * pulling in a YAML dependency to read two strings is not worth the surface.
 */
export function parsePromptFile(raw: string): ParsedPromptFile {
	const withoutBom = raw.replace(/^\uFEFF/, "");
	const frontmatterMatch = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(withoutBom);
	if (frontmatterMatch === null) {
		return { promptFileBody: withoutBom, promptFileFrontmatter: {} };
	}
	const frontmatterFields: Record<string, string> = {};
	for (const line of (frontmatterMatch[1] ?? "").split(/\r?\n/)) {
		// Indented lines belong to a nested structure we do not model.
		if (line.trim() === "" || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key !== "") frontmatterFields[key] = value;
	}
	return {
		promptFileBody: withoutBom.slice(frontmatterMatch[0].length),
		promptFileFrontmatter: frontmatterFields,
	};
}

/** Split a `tools:` frontmatter value into tool names. */
export function parseDeclaredTools(value: string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	const stripped = value.replace(/^\[/, "").replace(/\]$/, "");
	const tools = stripped
		.split(",")
		.map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
		.filter((entry) => entry !== "");
	return tools.length > 0 ? tools : undefined;
}

/**
 * Apply defaults and check types. Throws before any substitution happens, so a
 * bad argument set can never reach a prompt half-filled.
 */
export function validateArgs(
	manifest: Pick<AgentManifest, "args">,
	args: Record<string, string | undefined>,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	const missingArgNames: string[] = [];
	const invalidArgMessages: string[] = [];

	for (const spec of manifest.args) {
		const submitted = args[spec.name];
		const value = submitted !== undefined && submitted !== "" ? submitted : spec.default;
		if (value === undefined || value === "") {
			if (spec.required === true) missingArgNames.push(spec.name);
			continue;
		}
		if (spec.type === "number" && !isNumeric(value)) {
			invalidArgMessages.push(`${spec.name} must be a number, got "${value}"`);
			continue;
		}
		if (spec.type === "boolean" && !isBooleanish(value)) {
			invalidArgMessages.push(`${spec.name} must be true or false, got "${value}"`);
			continue;
		}
		resolved[spec.name] = value;
	}

	if (missingArgNames.length > 0) {
		throw new ValidationError(`missing required argument(s): ${missingArgNames.join(", ")}`, {
			missingArgNames,
		});
	}
	if (invalidArgMessages.length > 0) {
		throw new ValidationError(invalidArgMessages.join("; "), { invalidArgMessages });
	}
	return resolved;
}

function isNumeric(value: string): boolean {
	const trimmed = value.trim();
	return trimmed !== "" && Number.isFinite(Number(trimmed));
}

function isBooleanish(value: string): boolean {
	return ["true", "false", "1", "0", "yes", "no"].includes(value.trim().toLowerCase());
}

/** Resolve without validating. Used where a partial line is better than a throw. */
function resolveLoosely(
	manifest: Pick<AgentManifest, "args">,
	args: Record<string, string | undefined>,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	for (const spec of manifest.args) {
		const submitted = args[spec.name];
		const value = submitted !== undefined && submitted !== "" ? submitted : spec.default;
		if (value !== undefined && value !== "") resolved[spec.name] = value;
	}
	return resolved;
}

function quoteIfNeeded(value: string): string {
	return /[\s"'\\]/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Build what a human would have typed after the slash command: positionals in
 * ArgSpec order, then flags. This is what `$ARGUMENTS` expands to.
 */
export function assembleArgumentLine(
	manifest: Pick<AgentManifest, "args">,
	args: Record<string, string | undefined>,
): string {
	const resolved = resolveLoosely(manifest, args);
	const positionalParts: string[] = [];
	const flagParts: string[] = [];

	for (const spec of manifest.args) {
		const value = resolved[spec.name];
		const shape = classifySlot(spec.slot);
		if (shape.slotKind === "flag") {
			// A flag with no value is simply absent from the line.
			if (value !== undefined) flagParts.push(`${shape.slotFlag}"${value}"`);
			continue;
		}
		if (shape.slotKind === "template") continue;
		if (value === undefined) continue;
		if (shape.slotKind === "defaulted") {
			positionalParts.push(quoteIfNeeded(value));
			continue;
		}
		if (shape.slotKind === "positional" || shape.slotKind === "literal") {
			positionalParts.push(quoteIfNeeded(value));
		}
	}

	return [...positionalParts, ...flagParts].join(" ");
}

/**
 * Where `prompt.kind === "console"` bodies live: paths are relative to the repo
 * root, so a manifest says `prompts/plan-week.md` and means exactly that from
 * any entry point. Resolving against the cwd instead would land somewhere
 * different for `pnpm dev` (apps/web) than for `pnpm seed` (packages/core).
 *
 * These are the prompts Arnold owns rather than borrows. An agent reusable
 * across several repos belongs here; one that encodes a single project's
 * process belongs in that project's own `.claude/` and uses `kind: "repo"`.
 */
function consolePromptRoot(): string {
	const fromEnv = process.env.ARNOLD_REGISTRY_ROOT;
	if (fromEnv !== undefined && fromEnv !== "") return path.resolve(fromEnv);
	return repoRoot();
}

async function readPromptSource(
	manifest: Pick<AgentManifest, "prompt" | "id">,
	workspaceRoot: string,
): Promise<string> {
	const source = manifest.prompt;
	if (source.kind === "script") {
		throw new ValidationError(
			`agent ${manifest.id} is a script harness (${source.command}); it has no prompt body to render`,
			{ agentId: manifest.id },
		);
	}
	const absolute =
		source.kind === "repo"
			? path.join(workspaceRoot, source.path)
			: path.join(consolePromptRoot(), source.path);
	try {
		return await readFile(absolute, "utf8");
	} catch {
		throw new ValidationError(
			`prompt file not found for agent ${manifest.id}: ${absolute}. The manifest points at ${source.path}; either the file moved or the agent is orphaned.`,
			{ agentId: manifest.id, promptPath: absolute },
		);
	}
}

/**
 * Fill `{{name}}` placeholders in a manifest `contextTemplate`. Unfilled ones are
 * blanked rather than left in place: a literal `{{hotFiles}}` reaching the model
 * reads as an instruction to invent one.
 */
function fillContextTemplate(
	template: string,
	manifest: Pick<AgentManifest, "args">,
	resolved: Record<string, string>,
): string {
	let filled = template;
	for (const spec of manifest.args) {
		const value = resolved[spec.name] ?? "";
		filled = filled.replaceAll(`{{${spec.name}}}`, value);
		const shape = classifySlot(spec.slot);
		if (shape.slotKind === "template" && shape.slotTemplateName !== spec.name) {
			filled = filled.replaceAll(`{{${shape.slotTemplateName}}}`, value);
		}
	}
	return filled.replace(LEFTOVER_TEMPLATE_RE, "");
}

/**
 * Fill the prompt body's `{{name}}` placeholders from the manifest's `values`
 * map, then refuse to render if any remain.
 *
 * Unfilled placeholders are an error, not something to blank. `contextTemplate`
 * strips its leftovers because an absent optional argument legitimately renders
 * as nothing there; a body placeholder is different. It is a repo constant the
 * manifest was supposed to supply, and stripping it silently rewrites the
 * instruction — `git diff {{defaultBranch}}...HEAD` becomes `git diff ...HEAD`,
 * which is still a valid command meaning something else. Failing here costs a
 * render; failing later costs a whole run and produces a plausible wrong answer.
 */
function fillManifestValues(body: string, manifest: Pick<AgentManifest, "id" | "values">): string {
	let filled = body;
	for (const [name, value] of Object.entries(manifest.values ?? {})) {
		filled = filled.replaceAll(`{{${name}}}`, value);
	}

	const leftover = [...new Set(filled.match(LEFTOVER_TEMPLATE_RE) ?? [])];
	if (leftover.length > 0) {
		throw new ValidationError(
			`agent ${manifest.id}: the prompt body still contains ${leftover.join(", ")} after rendering. Add ${leftover.length === 1 ? "it" : "them"} to the manifest's \`values\` map — these are per-repo constants, so the value belongs to this repo's manifest, not to the prompt.`,
			{ agentId: manifest.id, unfilledPlaceholders: leftover },
		);
	}
	return filled;
}

function substituteSlot(body: string, spec: ArgSpec, value: string | undefined): string {
	const shape = classifySlot(spec.slot);
	switch (shape.slotKind) {
		case "positional": {
			// The negative lookahead stops `$1` from eating the `1` of a `$10`.
			const token = new RegExp(`\\$${shape.slotIndex}(?!\\d)`, "g");
			return body.replace(token, value ?? "");
		}
		case "defaulted": {
			// The whole `${1:-main}` token is replaced, so the inline default in the
			// prompt file stays authoritative when no value was submitted.
			const token = new RegExp(escapeRegExp(spec.slot), "g");
			return body.replace(token, value ?? shape.slotInlineDefault);
		}
		case "flag":
			// Flags are not in the body; they ride along on $ARGUMENTS.
			return body;
		case "template":
			// Template slots belong to contextTemplate only.
			return body;
		case "literal":
			return value === undefined ? body : body.replaceAll(shape.slotToken, value);
	}
}

/**
 * Read the prompt body for `manifest`, substitute every declared slot, expand
 * `$ARGUMENTS`, and append the filled `contextTemplate`.
 *
 * `workspaceRoot` is the leased checkout, so a repo-sourced prompt is read from
 * the same tree the agent will run against — never from a stale copy.
 */
export async function renderPrompt(
	manifest: AgentManifest,
	args: Record<string, string | undefined>,
	workspaceRoot: string,
): Promise<RenderedPrompt> {
	const resolved = validateArgs(manifest, args);
	const raw = await readPromptSource(manifest, workspaceRoot);
	const { promptFileBody, promptFileFrontmatter } = parsePromptFile(raw);
	const declaredTools = parseDeclaredTools(promptFileFrontmatter["tools"]);

	let body = promptFileBody;
	for (const spec of manifest.args) {
		body = substituteSlot(body, spec, resolved[spec.name]);
	}
	body = body.replaceAll("$ARGUMENTS", assembleArgumentLine(manifest, args));
	body = fillManifestValues(body, manifest);

	if (manifest.contextTemplate !== undefined && manifest.contextTemplate !== "") {
		const context = fillContextTemplate(manifest.contextTemplate, manifest, resolved);
		body = `${body.trimEnd()}\n${context}`;
	}

	return declaredTools === undefined ? { promptBody: body } : { promptBody: body, declaredTools };
}
