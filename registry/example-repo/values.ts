/**
 * Purpose: the per-repo constants the eight reference prompts expect, in one
 * place so eight manifests cannot drift into eight different default branches.
 *
 * These are the values genericization replaced with `{{placeholders}}`. They are
 * facts about the target repo, not arguments: nobody types them per run. Which
 * makes this map the first, smallest slice of the definition/binding split the
 * roadmap describes — the prompt is the definition, this is the binding, and
 * `registry/<slug>/` is already per-repo so it needs no new machinery.
 *
 * Placeholder-to-value, and nothing else. A manifest spreads in only the keys
 * its own prompt actually reads, so an unused value in a prompt is a rendering
 * error rather than something silently carried.
 */
import { jiraTracker } from "../trackers/index.js";

export const exampleRepoValues = {
	defaultBranch: "main",
	trackerProjectKey: "PROJ",
	trackerParentIssue: "PROJ-1",
	timezone: "Europe/Copenhagen",
	workingHours: "09:00-17:00",
} as const;

/**
 * The tracker half of the binding, kept here for the same reason as the rest:
 * two manifests read it and they must not drift into two different projects.
 *
 * Jira, because this registry documents a real Jira project and the prose in
 * `registry/trackers/jira.ts` came out of these prompts. It is not the default
 * for a new repo — `githubTracker` costs no new credential and `noTracker` is
 * the honest answer for a repo with one committer. See docs/DECISIONS.md #20.
 */
export const exampleRepoTracker = jiraTracker({
	projectKey: exampleRepoValues.trackerProjectKey,
	parentIssue: exampleRepoValues.trackerParentIssue,
});
