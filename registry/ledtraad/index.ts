/**
 * Purpose: the manifest set for ledtraad — a Python RAG pipeline over the Palme
 * investigation archive.
 *
 * Four agents. The first two sit on opposite sides of the definition/binding
 * line on purpose, because this directory is where that distinction shows:
 *
 *   doc-drift            prompt in Arnold  — the auditing discipline is
 *                                            reusable, only the measurements
 *                                            are ledtraad's
 *   docid-invariant      prompt in ledtraad — the (nummer, drive_id) rule is a
 *                                            fact about this corpus
 *   work-order-scoper    prompt in Arnold  — bound with GitHub issues as
 *                                            tickets; tries to reject an issue
 *                                            before anyone works on it
 *
 * `ledtraad-pre-pr-review` edits the working tree in the sandbox and never commits.
 * The rest are `read-only`. ledtraad has PRs, CI and a GitHub board since late
 * September but a single committer, and nothing executes an agent's output
 * there yet (ROADMAP Phases 2 and 3). So the useful thing an agent can do
 * here is notice something and say so. Only the sandboxed `working-tree` agent may
 * change files, and only in a disposable checkout.
 *
 * Hand-maintained, like `example-repo/index.ts`: adding an agent means adding a
 * line here, which is what keeps the registry type-checked at build time.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as docDriftManifest } from "./doc-drift.js";
import { manifest as docidInvariantManifest } from "./docid-invariant.js";
import { manifest as prePrReviewManifest } from "./pre-pr-review.js";
import { manifest as workOrderScoperManifest } from "./work-order-scoper.js";

/** Display order: read-only agents cheapest-first, then the one that writes. */
export const ledtraadManifests: AgentManifest[] = [
	docDriftManifest,
	docidInvariantManifest,
	workOrderScoperManifest,
	// The first that can change the repo (working-tree), so last: held until solo mode
	// and the sandbox release it.
	prePrReviewManifest,
];
