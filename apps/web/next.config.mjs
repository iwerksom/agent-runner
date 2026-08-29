/**
 * Purpose: Next configuration for Arnold's web tier (App Router).
 *
 * It also loads the monorepo's root env file. Next only reads env files from
 * this app's own directory, but the root `.env.local` is Arnold's single source
 * of truth (see scripts/with-env.mjs, which does the same for the CLI scripts).
 * Loading it here rather than duplicating secrets into `apps/web/.env.local`
 * keeps one file to edit and one file to keep out of git.
 *
 * Two things below are load-bearing:
 *   - `@arnold/core` ships TypeScript sources, so it must be transpiled by the
 *     app rather than consumed as a built package.
 *   - Prisma and the Claude Agent SDK must stay external to the server bundle.
 *     Both load native/dynamic files at runtime and break when bundled.
 *
 * There is deliberately no `experimental` block: route handlers stream
 * `ReadableStream` responses natively in Next 16, so SSE needs no flags.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// `.env.local` first, then `.env`, matching Next's own precedence. loadEnvFile
// does not overwrite variables already in the environment, so a real shell
// export still wins, and an apps/web-local env file can still override these.
for (const candidate of [".env.local", ".env"]) {
	const candidatePath = join(repoRoot, candidate);
	if (!existsSync(candidatePath)) continue;
	try {
		process.loadEnvFile(candidatePath);
	} catch (caught) {
		console.warn(`[arnold] could not read ${candidate} from the repo root: ${String(caught)}`);
	}
}

if (process.env.DATABASE_URL === undefined) {
	console.warn(
		"[arnold] DATABASE_URL is not set. Copy .env.example to .env.local at the repo root.",
	);
}

/** @type {import("next").NextConfig} */
const nextConfig = {
	transpilePackages: ["@arnold/core"],
	serverExternalPackages: ["@prisma/client", "@anthropic-ai/claude-agent-sdk"],

	webpack(config) {
		/**
		 * `@arnold/core` is TypeScript ESM, so its internal imports carry the `.js`
		 * extension the emitted JavaScript would have (`export * from "./agents.js"`).
		 * That is correct for Node ESM and TypeScript resolves it, but webpack takes
		 * the specifier literally, looks for `agents.js` next to `agents.ts`, and
		 * fails with "Can't resolve './agents.js'".
		 *
		 * extensionAlias tells webpack to try `.ts` and `.tsx` before `.js` for any
		 * `.js` specifier. Preferred over stripping the extensions from 16 source
		 * files, because those extensions are what let core run under plain Node
		 * later, unbundled.
		 */
		config.resolve.extensionAlias = {
			...config.resolve.extensionAlias,
			".js": [".ts", ".tsx", ".js"],
			".mjs": [".mts", ".mjs"],
		};

		/**
		 * Belt and braces for the dev watcher. Leased worktrees now default to a
		 * path outside the repo (see packages/core/src/paths.ts), but if someone
		 * points ARNOLD_WORKSPACE_ROOT back inside it, a full checkout of the
		 * target repo would appear under a watched directory and the watcher would
		 * try to compile thousands of files it should never see.
		 */
		config.watchOptions = {
			...config.watchOptions,
			ignored: ["**/node_modules/**", "**/.git/**", "**/.arnold/**", "**/workspaces/**"],
		};
		return config;
	},
};

export default nextConfig;
