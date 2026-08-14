/**
 * Purpose: the manifest set for the `diamond-frontend` repo, as a static array.
 *
 * Hand-maintained on purpose. A dynamic fs scan of this directory cannot be
 * bundled by Next, and a registry that only resolves at runtime cannot be
 * type-checked at build time either. Adding an agent means adding a line here,
 * which is a fair price for both.
 *
 * The type import is `import type` so this module has no runtime dependency on
 * @arnold/core, which would otherwise close a require cycle with
 * packages/core/src/registry.ts.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as aiSmellScanManifest } from "./ai-smell-scan.js";
import { manifest as fixPrCommentsManifest } from "./fix-pr-comments.js";
import { manifest as planWeekManifest } from "./plan-week.js";
import { manifest as prLoopAnalyzerSubagentManifest } from "./pr-loop-analyzer-subagent.js";
import { manifest as prLoopAnalyzerManifest } from "./pr-loop-analyzer.js";
import { manifest as prePrReviewManifest } from "./pre-pr-review.js";
import { manifest as workOrderScoperManifest } from "./work-order-scoper.js";
import { manifest as workQueueManifest } from "./work-queue.js";

/**
 * Order is display order in the console, and it is ordered by privilege:
 * read-only first, external-writes last. Reading down this list should read as
 * "how much can this one break".
 */
export const diamondFrontendManifests: AgentManifest[] = [
	// read-only
	workOrderScoperManifest,
	aiSmellScanManifest,
	// artifacts
	prLoopAnalyzerManifest,
	planWeekManifest,
	// working-tree
	prePrReviewManifest,
	// draft-pr
	workQueueManifest,
	// external-writes
	fixPrCommentsManifest,
	prLoopAnalyzerSubagentManifest,
];
