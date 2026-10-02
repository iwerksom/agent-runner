/**
 * Purpose: the manifest set for `sandbox`, a throwaway local repo for proving
 * a run end to end. One read-only agent, and one `artifacts` agent whose only write is a file under `reports/`.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as docDriftManifest } from "./doc-drift.js";
import { manifest as readmeReportManifest } from "./readme-report.js";

export const sandboxManifests: AgentManifest[] = [docDriftManifest, readmeReportManifest];
