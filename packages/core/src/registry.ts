/**
 * Purpose: reconcile the static manifest registry against what is actually in a
 * repo's `.claude` directory, and write the result to the Agent table.
 *
 * The repo is the source of truth for prompts, the registry is the source of
 * truth for metadata, and they drift. This file makes the drift visible instead
 * of letting it fail at run time:
 *   - manifest + prompt file  -> "active"
 *   - manifest, no prompt file -> "orphaned"
 *   - prompt file, no manifest -> "unregistered" (listable, never runnable)
 * Plus a cheap argument-count check, because a manifest whose positional count
 * disagrees with the file's `argument-hint` is the most likely silent breakage.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Agent, Repo } from "@prisma/client";
import { registryManifests } from "../../../registry/index.js";
import type { AgentKind, AgentManifest } from "./agents.js";
import { prisma } from "./db.js";
import { NotFoundError } from "./errors.js";
import { parseJsonColumn, stringifyJsonColumn } from "./json.js";
import { parsePromptFile, repoVariablesRequiredBy } from "./prompt.js";

/**
 * Which library agents need each repo variable, as `{ trackerProjectKey:
 * ["plan-week", ...] }`. The repo form shows it under each field, because "the
 * tracker project key" means nothing until you know which agents refuse to run
 * without it. Console prompts only: a repo-sourced prompt lives in a checkout.
 */
export async function repoVariableUsage(): Promise<Record<string, string[]>> {
	const usage: Record<string, string[]> = {};
	for (const manifest of registryManifests) {
		if (manifest.prompt.kind !== "console") continue;
		for (const name of await repoVariablesRequiredBy(manifest, "")) {
			(usage[name] ??= []).push(manifest.id);
		}
	}
	return usage;
}

export type SyncRegistryResult = {
	/** Manifest ids written as "active". */
	upserted: string[];
	/** Manifest ids whose prompt file is gone. */
	orphaned: string[];
	/** Prompt files with no manifest, as "<kind-dir>/<id>". */
	unregistered: string[];
	/** Human-readable drift notes for the console to surface. */
	driftWarnings: string[];
};

export type AgentWithManifest = {
	agentRow: Agent;
	/**
	 * Undefined for an "unregistered" agent, whose manifest column is "{}". Those
	 * rows exist to be listed, never run, so the caller must guard rather than be
	 * handed a manifest-shaped object with no fields in it.
	 */
	agentManifest?: AgentManifest;
};

/**
 * Manifests that apply to `repoSlug`. Async so the signature survives Phase 1,
 * where the registry may be fetched rather than bundled.
 */
export async function loadManifests(repoSlug: string): Promise<AgentManifest[]> {
	return registryManifests.filter(
		(manifest) => manifest.repos.includes(repoSlug) || manifest.repos.includes("*"),
	);
}

/** Positional args, for the argument-hint drift check. */
function positionalArgCount(manifest: AgentManifest): number {
	return manifest.args.filter((spec) => {
		// A `{{name}}` slot is prose context, and a `--flag=` slot is named, so
		// neither is positional. Everything else occupies a position in the
		// invocation, including a literal token like `<PR>`.
		if (/^\{\{\w+\}\}$/.test(spec.slot)) return false;
		if (spec.slot.endsWith("=")) return false;
		return true;
	}).length;
}

/**
 * `<pr-number> [base-branch]` -> 2. Counts bracketed placeholders, minus the
 * ones that are named flags rather than positions.
 *
 * Brackets mark optionality, not position: plan-week's hint reads
 * `[ISO week: ...] [--windows="..."] [--hours=N]`, which is one positional and
 * two named flags. Counting all three reported drift against a manifest that was
 * right, and a warning that cries wolf on a correct manifest is worse than no
 * warning at all — it teaches the operator to skip the list that also carries
 * the real ones.
 */
function positionalHintCount(argumentHint: string): number {
	const matches = argumentHint.match(/<[^>]+>|\[[^\]]+\]/g) ?? [];
	return matches.filter((placeholder) => !/^[[<]\s*-/.test(placeholder)).length;
}

function kindForCommandDir(directoryName: string): AgentKind {
	return directoryName === "agents" ? "subagent" : "command";
}

async function pathExists(candidate: string): Promise<boolean> {
	try {
		await stat(candidate);
		return true;
	} catch {
		return false;
	}
}

/** `.md` files directly inside `<checkout>/<claudeDir>/<subdir>`, ids only. */
async function listPromptFileIds(
	checkoutPath: string,
	claudeDir: string,
	subdir: string,
): Promise<string[]> {
	const directory = path.join(checkoutPath, claudeDir, subdir);
	try {
		const entries = await readdir(directory, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name.slice(0, -".md".length));
	} catch {
		// A repo with no .claude/commands is normal, not an error.
		return [];
	}
}

async function upsertAgentRepoRows(agentId: string, manifest: AgentManifest): Promise<void> {
	const repoRows: Repo[] = manifest.repos.includes("*")
		? await prisma.repo.findMany()
		: await prisma.repo.findMany({ where: { slug: { in: manifest.repos } } });
	for (const repoRow of repoRows) {
		await prisma.agentRepo.upsert({
			where: { agentId_repoId: { agentId, repoId: repoRow.id } },
			create: { agentId, repoId: repoRow.id, enabled: true },
			update: {},
		});
	}
}

async function readArgumentHint(promptFilePath: string): Promise<string | undefined> {
	try {
		const raw = await readFile(promptFilePath, "utf8");
		return parsePromptFile(raw).promptFileFrontmatter["argument-hint"];
	} catch {
		return undefined;
	}
}

/**
 * Reconcile the registry for one repo. Safe to run repeatedly; it is the seed
 * script's only job and the console's "rescan" button.
 */
export async function syncRegistry(repoSlug: string): Promise<SyncRegistryResult> {
	const repoRow = await prisma.repo.findUnique({ where: { slug: repoSlug } });
	if (repoRow === null) {
		throw new NotFoundError(`no repo "${repoSlug}"; add it on the repos page first`, {
			repoSlug,
		});
	}

	const manifests = await loadManifests(repoSlug);
	const result: SyncRegistryResult = {
		upserted: [],
		orphaned: [],
		unregistered: [],
		driftWarnings: [],
	};

	const checkoutPath = repoRow.localPath ?? undefined;
	const checkoutPresent = checkoutPath !== undefined && (await pathExists(checkoutPath));
	if (!checkoutPresent) {
		result.driftWarnings.push(
			`checkout for ${repoSlug} is not on disk (localPath=${checkoutPath ?? "unset"}); prompt files were not verified, so orphan and unregistered detection was skipped`,
		);
	}

	for (const manifest of manifests) {
		let agentState: string = "active";
		if (checkoutPresent && checkoutPath !== undefined && manifest.prompt.kind === "repo") {
			const promptFilePath = path.join(checkoutPath, manifest.prompt.path);
			if (!(await pathExists(promptFilePath))) {
				agentState = "orphaned";
				result.orphaned.push(manifest.id);
			}
		}
		// A deliberate hold outranks orphan detection. Both are unrunnable, but
		// "someone decided this must not run" is the more actionable message, and
		// it must not be silently relabelled by a checkout that moved a file.
		if (manifest.disabled !== undefined) agentState = "disabled";

		const agentFields = {
			name: manifest.name,
			description: manifest.description,
			kind: manifest.kind,
			state: agentState,
			invocable: manifest.invocable,
			writeScope: manifest.writeScope,
			execution: manifest.execution,
			scopeEnforcement: manifest.scopeEnforcement,
			promptSource: stringifyJsonColumn(manifest.prompt),
			mainBookkeeping:
				manifest.mainBookkeeping === undefined
					? null
					: stringifyJsonColumn(manifest.mainBookkeeping),
			manifest: stringifyJsonColumn(manifest),
		};

		await prisma.agent.upsert({
			where: { id: manifest.id },
			create: { id: manifest.id, ...agentFields },
			update: agentFields,
		});
		await upsertAgentRepoRows(manifest.id, manifest);
		if (agentState === "active") result.upserted.push(manifest.id);

		// Drift: does the file's argument-hint agree with the manifest's slots?
		if (checkoutPresent && checkoutPath !== undefined && manifest.prompt.kind === "repo") {
			const argumentHint = await readArgumentHint(
				path.join(checkoutPath, manifest.prompt.path),
			);
			if (argumentHint !== undefined) {
				const hintCount = positionalHintCount(argumentHint);
				const slotCount = positionalArgCount(manifest);
				if (hintCount !== slotCount) {
					result.driftWarnings.push(
						`${manifest.id}: prompt file declares argument-hint "${argumentHint}" (${hintCount} positional placeholder(s)) but the manifest declares ${slotCount}. Check the slot mapping before running.`,
					);
				}
			}
		}
	}

	if (!checkoutPresent || checkoutPath === undefined) return result;

	// Anything in .claude with no manifest is listed so it is discoverable, and
	// left unrunnable so nobody executes a prompt whose tool policy is fiction.
	const manifestIds = new Set(manifests.map((manifest) => manifest.id));
	const seenIdsByDir = new Map<string, string[]>();

	for (const subdir of ["commands", "agents"]) {
		const promptIds = await listPromptFileIds(checkoutPath, repoRow.claudeDir, subdir);
		seenIdsByDir.set(subdir, promptIds);
		for (const promptId of promptIds) {
			if (manifestIds.has(promptId)) continue;
			const kind = kindForCommandDir(subdir);
			const unregisteredFields = {
				name: promptId,
				description: `Unregistered ${kind} found at ${repoRow.claudeDir}/${subdir}/${promptId}.md. Add a manifest to make it runnable.`,
				kind,
				state: "unregistered",
				invocable: "direct",
				writeScope: "read-only",
				execution: "unattended",
				scopeEnforcement: "prompt-only",
				promptSource: stringifyJsonColumn({
					kind: "repo",
					path: `${repoRow.claudeDir}/${subdir}/${promptId}.md`,
				}),
				mainBookkeeping: null,
				manifest: "{}",
			};
			await prisma.agent.upsert({
				where: { id: promptId },
				create: { id: promptId, ...unregisteredFields },
				update: unregisteredFields,
			});
			await prisma.agentRepo.upsert({
				where: { agentId_repoId: { agentId: promptId, repoId: repoRow.id } },
				create: { agentId: promptId, repoId: repoRow.id, enabled: true },
				update: {},
			});
			result.unregistered.push(`${subdir}/${promptId}`);
		}
	}

	// A name living in both directories is the pr-loop-analyzer trap: two files,
	// different behaviour and different write scopes, one Agent id. The collision
	// itself belongs to the target repo and Arnold cannot fix it; what Arnold can
	// tell you is whether BOTH files are described. A manifest claims a file by
	// its prompt path, not by its id, so an overlay registered under an explicit
	// id resolves the shadowing and the warning goes quiet.
	const claimedPromptPaths = new Set(
		manifests.flatMap((manifest) =>
			manifest.prompt.kind === "repo" ? [manifest.prompt.path.split("\\").join("/")] : [],
		),
	);
	const commandIds = new Set(seenIdsByDir.get("commands") ?? []);
	for (const subagentId of seenIdsByDir.get("agents") ?? []) {
		if (!commandIds.has(subagentId)) continue;
		const subagentPromptPath = `${repoRow.claudeDir}/agents/${subagentId}.md`;
		if (claimedPromptPaths.has(subagentPromptPath)) continue;
		result.driftWarnings.push(
			`${subagentId}: exists as both a command and a subagent in ${repoRow.claudeDir}, and the subagent file has no manifest of its own, so it is shadowed and invisible. Register it under an explicit id pointing at ${subagentPromptPath}.`,
		);
	}

	return result;
}

/** The Agent row plus its parsed manifest. Throws when the row is missing. */
export async function getAgentWithManifest(agentId: string): Promise<AgentWithManifest> {
	const agentRow = await prisma.agent.findUnique({ where: { id: agentId } });
	if (agentRow === null) {
		throw new NotFoundError(`no agent "${agentId}"`, { agentId });
	}
	const parsed = parseJsonColumn<Partial<AgentManifest>>(agentRow.manifest, {});
	// `id` is the cheapest proof that this is a real manifest and not the "{}"
	// placeholder an unregistered prompt file gets.
	const agentManifest = typeof parsed.id === "string" ? (parsed as AgentManifest) : undefined;
	return agentManifest === undefined ? { agentRow } : { agentRow, agentManifest };
}
