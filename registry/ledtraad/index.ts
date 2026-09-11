/**
 * Purpose: the manifest set for ledtraad — a Python RAG pipeline over the Palme
 * investigation archive.
 *
 * Two agents, and they sit on opposite sides of the definition/binding line on
 * purpose, because this directory is where that distinction is meant to show:
 *
 *   doc-drift        prompt in Arnold  — the auditing discipline is reusable,
 *                                        only the measurements are ledtraad's
 *   docid-invariant  prompt in ledtraad — the (nummer, drive_id) rule is a fact
 *                                        about this corpus and nothing else
 *
 * Both are `read-only`, which is not a coincidence. ledtraad has no CI, no PR
 * flow and a single committer, so the useful thing an agent can do here is
 * notice something and say so. Nothing in this directory may write to the repo.
 *
 * Hand-maintained, like `example-repo/index.ts`: adding an agent means adding a
 * line here, which is what keeps the registry type-checked at build time.
 */

import type { AgentManifest } from "@arnold/core";
import { manifest as docDriftManifest } from "./doc-drift.js";
import { manifest as docidInvariantManifest } from "./docid-invariant.js";

/** Display order. Both are read-only, so this is just cheapest-first. */
export const ledtraadManifests: AgentManifest[] = [docDriftManifest, docidInvariantManifest];
