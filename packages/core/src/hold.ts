/**
 * Purpose: whether an agent's write scope is held, and why.
 *
 * Anything above `artifacts` can change a working tree, push, or write to a
 * tracker, so it must not be pressable by whoever can reach the console. Until
 * auth exists (ROADMAP Phase 8) the sandbox is what makes that safe, and only for a
 * single user: in solo mode (`ARNOLD_SOLO=1`) with the Docker sandbox on
 * (`ARNOLD_SANDBOX=docker`), a tier with a sandbox profile is released
 * (DECISIONS #26, feature 2.1). Outside solo mode every such tier stays held,
 * because the sandbox contains what an agent can do, not who may start it.
 *
 * The hold is computed on every request rather than stored on the agent row, so
 * switching the environment variables changes what is runnable without a registry
 * sync. A manifest's own `disabled` is a separate, per-agent decision.
 */

import { atLeast, type AgentManifest, type WriteScope } from "./agents.js";
import { SANDBOXED_SCOPES, sandboxEnabled } from "./sandbox.js";

/** The write scopes solo mode can release: those that have a sandbox profile. */
export function releasableInSoloMode(scope: WriteScope): boolean {
	return atLeast(scope, "working-tree") && SANDBOXED_SCOPES.includes(scope);
}

/** True for tiers that must run in the sandbox. */
export function requiresSandbox(scope: WriteScope): boolean {
	return atLeast(scope, "working-tree");
}

export function soloModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.ARNOLD_SOLO === "1";
}

/** The reason an agent is held, or undefined when its tier is released. */
export function tierHold(
	manifest: Pick<AgentManifest, "id" | "writeScope">,
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const scope = manifest.writeScope;
	if (!requiresSandbox(scope)) return undefined;
	if (!soloModeEnabled(env)) {
		return `Held: ${scope} can change a repo, and without auth anyone who can reach the console could start it. A single-user console releases it with ARNOLD_SOLO=1 and the Docker sandbox (ARNOLD_SANDBOX=docker); a shared one needs Phase 8 auth.`;
	}
	if (!releasableInSoloMode(scope)) {
		return `Held: ${scope} has no sandbox profile yet, so solo mode cannot release it.`;
	}
	if (env.ARNOLD_SANDBOX !== "docker") {
		return `Held: ${scope} runs only inside the Docker sandbox. Set ARNOLD_SANDBOX=docker and build the image (pnpm sandbox:build).`;
	}
	return undefined;
}
