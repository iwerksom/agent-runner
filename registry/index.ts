/**
 * Purpose: slug -> manifest array, the one place the runtime looks up which
 * agents exist for a repo. `syncRegistry` reconciles this map against a repo's
 * `.claude` directory; nothing else reads the registry directory directly.
 */

import type { AgentManifest } from "@arnold/core";
import { exampleRepoManifests } from "./example-repo/index.js";
import { ledtraadManifests } from "./ledtraad/index.js";

export const registryManifestsBySlug: Record<string, AgentManifest[]> = {
	"example-repo": exampleRepoManifests,
	ledtraad: ledtraadManifests,
};

/** Empty array for an unknown slug: a repo with no registered agents is valid. */
export function manifestsForRepoSlug(repoSlug: string): AgentManifest[] {
	return registryManifestsBySlug[repoSlug] ?? [];
}
