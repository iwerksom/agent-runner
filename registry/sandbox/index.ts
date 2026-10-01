/**
 * Purpose: the manifest set for `sandbox`, a throwaway local repo for proving
 * a run end to end. One read-only agent; nothing here may write to the repo.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as docDriftManifest } from "./doc-drift.js";

export const sandboxManifests: AgentManifest[] = [docDriftManifest];
