/**
 * Purpose: every manifest Arnold knows, the one place the runtime looks up which
 * agents exist. `syncRegistry` filters this list by each manifest's `repos`
 * field and reconciles it against a repo's `.claude` directory; nothing else
 * reads the registry directory directly.
 *
 * Repos are not named here. They live in the database and are added, selected
 * and removed from the console, so a manifest reaches a repo through
 * `repos: ["*"]` (or, for an agent that only makes sense on one project, that
 * project's slug in its own manifest), never through a slug-keyed map in code.
 */

import type { AgentManifest } from "@arnold/core";
import { libraryManifests } from "./library/index.js";

export const registryManifests: AgentManifest[] = [...libraryManifests];
