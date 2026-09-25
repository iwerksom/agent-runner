/**
 * Purpose: the public surface of @arnold/core. The web tier and the scripts
 * import from here and never reach into `src/*` directly, so the module layout
 * stays free to change.
 *
 * Ordered by the path a run takes: contract, store, errors, then Dispatcher ->
 * Runner -> Notary -> Ledger.
 */

// The agent contract. Everything else reads from it.
export * from "./agents.js";

// Store and column helpers.
export * from "./db.js";
export * from "./json.js";
export * from "./errors.js";

// On-disk locations. Resolved against the repo root, never the cwd, because the
// cwd differs per entry point: apps/web for `pnpm dev`, packages/core for seed.
export * from "./paths.js";

// Target repositories: onboarding, editing and retirement, and the per-repo
// values a prompt's {{variables}} take.
export * from "./repos.js";
export * from "./repoVariables.js";

// Registry reconciliation and prompt rendering.
export * from "./registry.js";
export * from "./prompt.js";

// Execution: workspace lease, tool policy, the SDK loop, the entry gate.
export * from "./workspace.js";
export * from "./writeScope.js";
export * from "./sdkAdapter.js";
export * from "./runner.js";
export * from "./dispatcher.js";

// After a run: artifacts, outcome, provenance, spend, live events.
export * from "./collect.js";
export * from "./notary.js";
export * from "./ledger.js";
export * from "./bus.js";
