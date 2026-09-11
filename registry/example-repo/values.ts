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
export const exampleRepoValues = {
	defaultBranch: "main",
	trackerProjectKey: "PROJ",
	trackerParentIssue: "PROJ-1",
	timezone: "Europe/Copenhagen",
	workingHours: "09:00-17:00",
} as const;
