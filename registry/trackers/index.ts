/**
 * Purpose: the three tracker bindings, and the note that this directory is not
 * a repo.
 *
 * `registry/<slug>/` is per-repo; `registry/trackers/` is not — it holds shared
 * bindings that a repo's manifests spread into their `values` map. It is
 * deliberately absent from `registryManifestsBySlug`, and `manifestsForRepoSlug`
 * returning `[]` for "trackers" is correct, not a gap.
 *
 * Which to use:
 *
 *   githubTracker  free, no new credential — `gh` is already authenticated for
 *                  `gh pr create`. The default for any repo with a PR flow.
 *   noTracker      a single-committer repo with no board. `queue.jsonl` is the
 *                  board. The default for ledtraad.
 *   jiraTracker    kept because it works and because the reference registry
 *                  documents a real Jira project. Needs four secrets.
 *
 * See docs/DECISIONS.md #20 for why this is a binding rather than a branch
 * inside the prompt.
 */

export { githubTracker, type GithubTrackerConfig } from "./github.js";
export { jiraTracker, type JiraTrackerConfig } from "./jira.js";
export { noTracker, type NoTrackerConfig } from "./none.js";
export { TRACKER_STATES, type TrackerBinding, type TrackerState } from "./types.js";
