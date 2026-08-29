/**
 * Purpose: run a command with the monorepo's root env file loaded.
 *
 * Why this exists: the Prisma CLI only reads `.env`, and only from its own
 * working directory or `./prisma`. Arnold's scripts run with cwd
 * `packages/core`, and the env file lives at the repo root as `.env.local`, so
 * Prisma finds nothing and fails with "Environment variable not found:
 * DATABASE_URL". Next has the mirror-image problem: it reads env files from
 * `apps/web`, not the repo root.
 *
 * Rather than keep three copies of the same secrets, the root `.env.local` is
 * the single source and this wrapper injects it for CLI tools.
 * `apps/web/next.config.mjs` does the same thing for the web app.
 *
 * Uses `process.loadEnvFile`, built into Node 20.12+, so this adds no
 * dependency and behaves the same on Windows and POSIX.
 *
 * Usage:
 *   node scripts/with-env.mjs [--require=VAR1,VAR2] <command> [args...]
 *
 * Examples:
 *   node ../../scripts/with-env.mjs --require=DATABASE_URL prisma db push
 *   node ../../scripts/with-env.mjs tsx ../../scripts/seed.ts
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Root file wins over `.env`, matching the convention Next uses. */
const CANDIDATE_ENV_FILES = [".env.local", ".env"];

const argv = process.argv.slice(2);
const requireArg = argv.find((arg) => arg.startsWith("--require="));
const required =
	requireArg === undefined
		? []
		: requireArg
				.slice("--require=".length)
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name !== "");
const commandArgv = argv.filter((arg) => !arg.startsWith("--require="));

if (commandArgv.length === 0) {
	console.error("with-env: no command given");
	process.exit(2);
}

const loadedFiles = [];
for (const candidate of CANDIDATE_ENV_FILES) {
	const candidatePath = join(repoRoot, candidate);
	if (!existsSync(candidatePath)) continue;
	try {
		// Does not overwrite variables already present in the environment, so a
		// real shell export still wins over the file.
		process.loadEnvFile(candidatePath);
		loadedFiles.push(candidate);
	} catch (caught) {
		console.error(`with-env: could not read ${candidate}: ${String(caught)}`);
		process.exit(2);
	}
}

const missing = required.filter((name) => {
	const value = process.env[name];
	return value === undefined || value === "";
});

if (missing.length > 0) {
	// Fail here rather than letting the wrapped tool fail, because the tool's own
	// message does not say which file it expected or where that file should live.
	console.error("");
	console.error(`with-env: missing required variable(s): ${missing.join(", ")}`);
	console.error(
		loadedFiles.length === 0
			? `with-env: no env file found at ${repoRoot}. Expected .env.local (or .env).`
			: `with-env: loaded ${loadedFiles.join(", ")} from ${repoRoot}, but the variable(s) above are not set in it.`,
	);
	console.error("");
	console.error("Fix: cp .env.example .env.local  (at the repo root), then fill it in.");
	console.error("");
	process.exit(2);
}

if (loadedFiles.length > 0) {
	console.log(`with-env: loaded ${loadedFiles.join(", ")}`);
}

/**
 * `shell: true` is required so Windows resolves the `.cmd` shims pnpm writes into
 * node_modules/.bin, but it makes the shell re-parse the whole command line. An
 * argument containing spaces, quotes or parens (`node -e "console.log(1)"`) then
 * becomes a syntax error, so each argument is quoted for the platform's shell
 * before being joined.
 */
function quoteForShell(arg) {
	if (process.platform === "win32") {
		// cmd.exe: double quotes, with embedded double quotes doubled.
		return /[\s"&|<>^()]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
	}
	// POSIX: single quotes, ending and reopening around any embedded single quote.
	return /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

const commandLine = commandArgv.map(quoteForShell).join(" ");
const child = spawn(commandLine, { stdio: "inherit", shell: true });

child.on("error", (error) => {
	console.error(`with-env: failed to start "${commandArgv[0]}": ${error.message}`);
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal !== null) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
