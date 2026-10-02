/**
 * Purpose: the manifest set for `sandbox`, a throwaway local repo for proving
 * a run end to end. One read-only agent, one `artifacts` agent whose only write is
 * a file under `reports/`, and one `working-tree` agent that edits a README.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as docDriftManifest } from "./doc-drift.js";
import { manifest as readmeFixManifest } from "./readme-fix.js";
import { manifest as readmeReportManifest } from "./readme-report.js";

export const sandboxManifests: AgentManifest[] = [
	docDriftManifest,
	readmeReportManifest,
	readmeFixManifest,
];
