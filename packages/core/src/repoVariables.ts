/**
 * Purpose: the values a console-owned prompt needs from the repo it runs
 * against, and the one function that fills them in.
 *
 * The library prompts in `prompts/` were genericized by replacing every
 * project-specific value with a `{{variable}}`. Those are not run arguments —
 * nobody should type the tracker project key on every run — they are facts
 * about the repo. So they live on the Repo row, are edited on the repos page,
 * and are filled into the prompt body before any argument is substituted.
 *
 * The catalogue below is the complete list. A name that is not in it is not a
 * repo variable, so it is left for the argument slots and `contextTemplate`
 * (`{{woNumber}}` and friends) and never mistaken for one. Adding a variable to
 * a prompt means adding it here, which is what makes it appear in the form.
 */

import type { Repo } from "@prisma/client";
import { ValidationError } from "./errors.js";
import { parseJsonColumn } from "./json.js";

export type RepoVariableSpec = {
	name: string;
	label: string;
	description: string;
	example: string;
	/**
	 * `column`: read from a Repo column the form already edits.
	 * `setting`: stored in `Repo.promptVariables` and edited as a prompt value.
	 */
	source: "column" | "setting";
};

export const REPO_VARIABLES: readonly RepoVariableSpec[] = [
	{
		name: "defaultBranch",
		label: "Default branch",
		description: "The branch work is based on and pull requests target.",
		example: "main",
		source: "column",
	},
	{
		name: "trackerProjectKey",
		label: "Tracker project key",
		description:
			"The issue-tracker project the agents query and file tasks in. Also the ticket and branch prefix, as in PROJ-123.",
		example: "PROJ",
		source: "setting",
	},
	{
		name: "trackerParentIssue",
		label: "Tracker parent issue",
		description: "The issue that tooling and tech-debt tasks are filed under.",
		example: "PROJ-100",
		source: "setting",
	},
	{
		name: "timezone",
		label: "Timezone",
		description: "The timezone the team plans in and reports are timestamped in.",
		example: "Europe/Copenhagen",
		source: "setting",
	},
	{
		name: "workingHours",
		label: "Working hours",
		description: "The hours a planned work window has to fall inside.",
		example: "09:00-17:00",
		source: "setting",
	},
];

/** The variables stored in `Repo.promptVariables`, in form order. */
export const REPO_SETTING_VARIABLES: readonly RepoVariableSpec[] = REPO_VARIABLES.filter(
	(spec) => spec.source === "setting",
);

const VARIABLE_BY_NAME = new Map(REPO_VARIABLES.map((spec) => [spec.name, spec]));
const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/** Every repo variable this repo has a value for, `defaultBranch` included. */
export function repoVariableValues(
	repo: Pick<Repo, "defaultBranch" | "promptVariables">,
): Record<string, string> {
	const stored = parseJsonColumn<Record<string, unknown>>(repo.promptVariables, {});
	const values: Record<string, string> = {};
	for (const spec of REPO_SETTING_VARIABLES) {
		const value = stored[spec.name];
		if (typeof value === "string" && value.trim() !== "") values[spec.name] = value.trim();
	}
	values.defaultBranch = repo.defaultBranch;
	return values;
}

/** The repo variables `text` refers to, deduplicated, in catalogue order. */
export function repoVariablesUsedIn(text: string): string[] {
	const used = new Set<string>();
	for (const match of text.matchAll(PLACEHOLDER_RE)) {
		const name = match[1];
		if (name !== undefined && VARIABLE_BY_NAME.has(name)) used.add(name);
	}
	return REPO_VARIABLES.map((spec) => spec.name).filter((name) => used.has(name));
}

/**
 * Replace every repo variable in `text` that has a value. Variables without one
 * are left in place and reported in `missing`, so the caller can refuse the run
 * rather than hand the model a literal `{{trackerProjectKey}}` — which it reads
 * as an invitation to invent a project key.
 */
export function fillRepoVariables(
	text: string,
	values: Record<string, string>,
): { filled: string; missing: string[] } {
	const missing = new Set<string>();
	const filled = text.replace(PLACEHOLDER_RE, (token, name: string) => {
		if (!VARIABLE_BY_NAME.has(name)) return token;
		const value = values[name];
		if (value === undefined || value === "") {
			missing.add(name);
			return token;
		}
		return value;
	});
	return { filled, missing: [...missing] };
}

/** The operator-facing refusal for a run whose repo lacks values its prompt needs. */
export function missingRepoVariablesError(
	agentId: string,
	repoSlug: string,
	missing: string[],
): ValidationError {
	const labels = missing.map((name) => VARIABLE_BY_NAME.get(name)?.label ?? name);
	return new ValidationError(
		`${agentId} needs ${labels.join(", ")} for repo "${repoSlug}", and ${missing.length === 1 ? "it is" : "they are"} not set. Add ${missing.length === 1 ? "it" : "them"} under Prompt values on the repos page.`,
		{ agentId, repoSlug, missingRepoVariables: missing },
	);
}

/**
 * Validate and tidy prompt values from the form: trims every value, drops empty
 * ones (an empty field means "not set"), and refuses names outside the
 * catalogue so a typo cannot store a value nothing will ever read.
 */
export function normalisePromptVariables(
	input: Record<string, string> | undefined,
): Record<string, string> {
	const normalised: Record<string, string> = {};
	if (input === undefined) return normalised;
	const unknown: string[] = [];
	for (const [name, value] of Object.entries(input)) {
		const spec = VARIABLE_BY_NAME.get(name);
		if (spec === undefined || spec.source !== "setting") {
			unknown.push(name);
			continue;
		}
		const trimmed = value.trim();
		if (trimmed !== "") normalised[name] = trimmed;
	}
	if (unknown.length > 0) {
		throw new ValidationError(
			`Unknown prompt value${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Known: ${REPO_SETTING_VARIABLES.map((spec) => spec.name).join(", ")}.`,
			{ unknown },
		);
	}
	return normalised;
}
