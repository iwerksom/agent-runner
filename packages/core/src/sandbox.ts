/**
 * Purpose: run an agent inside a Docker container whose reach matches its write
 * scope (ROADMAP feature 2.1, DECISIONS #28).
 *
 * A sandbox profile is compiled from the manifest: which paths are mounted and
 * how, which environment variables the process may see, and the container's
 * resource limits. The backend wraps the whole `claude` process through the SDK's
 * `spawnClaudeCodeProcess`, so the Read tool, Bash and the repo's own hooks are
 * all confined, not just shell commands. What the container cannot see, the agent
 * cannot read, whatever it tries and whatever the tool gate misses.
 *
 * Only `read-only` and `artifacts` have a profile so far. Every other scope throws
 * from `profileFor`, so a tier without a profile cannot run sandboxed by accident.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentManifest } from "./agents.js";
import { ValidationError } from "./errors.js";
import { repoRoot } from "./paths.js";

export const SANDBOX_IMAGE = process.env.ARNOLD_SANDBOX_IMAGE ?? "arnold-sandbox:dev";

export type SandboxMount = { host: string; container: string; writable: boolean };

export type SandboxProfile = {
	image: string;
	mounts: SandboxMount[];
	/** Environment names the process may keep from what the SDK hands over. */
	envAllow: RegExp;
	/** Extra variables set explicitly (HOME, PATH, forge token). */
	envSet: Record<string, string>;
	memory: string;
	cpus: string;
	pidsLimit: number;
};

/** SDK-set and model-auth variables only. Everything else stays on the host. */
const ENV_ALLOW = /^(ANTHROPIC_|CLAUDE_|CLAUDECODE|CLAUDE_AGENT_SDK|LANG$|LC_|TZ$|TERM$)/;

/**
 * The directory a glob writes into: its literal prefix up to the last separator
 * before the first wildcard. `.pr-loop/reports/PR-*-*.md` -> `.pr-loop/reports`.
 * A glob at the workspace root has no directory to narrow to and is refused,
 * because mounting the whole worktree writable would defeat the profile.
 */
export function artifactDirOf(glob: string): string {
	const firstWildcard = glob.search(/[*?[{]/);
	const literal = firstWildcard === -1 ? glob : glob.slice(0, firstWildcard);
	const dir = firstWildcard === -1 ? path.posix.dirname(glob) : path.posix.dirname(`${literal}x`);
	if (dir === "." || dir === "" || dir.startsWith("..") || path.posix.isAbsolute(dir)) {
		throw new ValidationError(
			`artifact glob "${glob}" writes at the workspace root, so it cannot be narrowed to a directory for the sandbox; give it a directory`,
			{ glob },
		);
	}
	return dir;
}

export type ProfileInput = {
	manifest: Pick<AgentManifest, "id" | "writeScope" | "artifactGlobs" | "tools">;
	workspacePath: string;
	mirrorPath: string;
	/** The `claude` executable the SDK will run; its directory is mounted read-only. */
	claudeExecutable: string;
};

export function profileFor(input: ProfileInput): SandboxProfile {
	const { manifest, workspacePath, mirrorPath, claudeExecutable } = input;
	if (manifest.writeScope !== "read-only" && manifest.writeScope !== "artifacts") {
		throw new ValidationError(
			`no sandbox profile for write scope ${manifest.writeScope} yet (agent ${manifest.id}); only read-only and artifacts are sandboxed`,
			{ agentId: manifest.id, writeScope: manifest.writeScope },
		);
	}
	// Same absolute paths inside and outside: a git worktree records absolute paths
	// to its admin directory, and transcripts and provenance must agree on where
	// files are.
	const mounts: SandboxMount[] = [
		{ host: workspacePath, container: workspacePath, writable: false },
		{ host: mirrorPath, container: mirrorPath, writable: false },
		{
			host: path.dirname(claudeExecutable),
			container: path.dirname(claudeExecutable),
			writable: false,
		},
	];
	if (manifest.writeScope === "artifacts") {
		for (const glob of manifest.artifactGlobs) {
			const dir = artifactDirOf(glob);
			const host = path.join(workspacePath, dir);
			mkdirSync(host, { recursive: true });
			if (!mounts.some((m) => m.container === host)) {
				mounts.push({ host, container: host, writable: true });
			}
		}
	}

	const envSet: Record<string, string> = {
		HOME: "/tmp/home",
		PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
	};
	// A read-only forge token, only for agents whose allow-list uses `gh`, and only
	// from a variable the operator set for exactly this purpose.
	const usesGh = manifest.tools.allowedTools.some((t) => /^Bash\(gh\b/.test(t));
	const forgeToken = process.env.ARNOLD_GH_READ_TOKEN;
	if (usesGh && forgeToken !== undefined && forgeToken !== "") envSet.GH_TOKEN = forgeToken;

	return {
		image: SANDBOX_IMAGE,
		mounts,
		envAllow: ENV_ALLOW,
		envSet,
		memory: "4g",
		cpus: "2",
		pidsLimit: 512,
	};
}

/** Variables the process may see: allow-listed SDK names, then the profile's own. */
export function sandboxEnv(
	profile: Pick<SandboxProfile, "envAllow" | "envSet">,
	sdkEnv: Record<string, string | undefined>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(sdkEnv)) {
		if (value !== undefined && profile.envAllow.test(key)) out[key] = value;
	}
	return { ...out, ...profile.envSet };
}

/** `docker run` arguments for one run. Pure, so it can be checked without Docker. */
export function dockerArgs(input: {
	name: string;
	profile: SandboxProfile;
	cwd: string;
	envFile: string;
	command: string;
	args: string[];
	uid: number;
	gid: number;
}): string[] {
	const { name, profile, cwd, envFile, command, args, uid, gid } = input;
	const flags = [
		"run",
		"--rm",
		"-i",
		"--name",
		name,
		// As the host user, so nothing in a writable mount becomes root-owned.
		"--user",
		`${uid}:${gid}`,
		"--read-only",
		"--tmpfs",
		"/tmp:exec,mode=1777",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		String(profile.pidsLimit),
		"--memory",
		profile.memory,
		"--cpus",
		profile.cpus,
		"--env-file",
		envFile,
		"-w",
		cwd,
	];
	for (const m of profile.mounts) {
		flags.push("-v", `${m.host}:${m.container}:${m.writable ? "rw" : "ro"}`);
	}
	return [...flags, profile.image, command, ...args];
}

/** Which uid and gid to run as. Not root. */
function hostIds(): { uid: number; gid: number } {
	return { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 };
}

/**
 * The `spawnClaudeCodeProcess` function for one run. `docker` is a ChildProcess,
 * which already satisfies the SDK's `SpawnedProcess`; the SDK talks to the agent
 * over its stdin and stdout, which `-i` passes through.
 *
 * Credentials go in a temporary `--env-file` (mode 0600) rather than `-e KEY=value`,
 * because the latter shows in `docker inspect` and the process list. The file is
 * deleted as soon as the container is producing output, and at exit at the latest.
 */
export function dockerSpawner(
	profile: SandboxProfile,
	runId: string,
): (options: SpawnOptions) => SpawnedProcess {
	return (options) => {
		const name = `arnold-${runId}`;
		const dir = path.join(os.tmpdir(), `arnold-env-${runId}`);
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const envFile = path.join(dir, "env");
		const env = sandboxEnv(profile, options.env);
		writeFileSync(
			envFile,
			Object.entries(env)
				.map(([k, v]) => `${k}=${v.replace(/\n/g, "\\n")}`)
				.join("\n") + "\n",
			{ mode: 0o600 },
		);
		const cleanup = () => rmSync(dir, { recursive: true, force: true });

		const { uid, gid } = hostIds();
		const argv = dockerArgs({
			name,
			profile,
			cwd: options.cwd ?? profile.mounts[0]?.container ?? "/tmp",
			envFile,
			command: options.command,
			args: options.args,
			uid,
			gid,
		});
		const child = spawn("docker", argv, { stdio: ["pipe", "pipe", "pipe"] });
		child.stdout.once("data", cleanup);
		child.once("exit", cleanup);
		child.once("error", cleanup);
		// Safety net if the container never prints.
		setTimeout(cleanup, 30_000).unref();

		// The SDK's own abort path closes stdin first and kills after a grace window;
		// when that fires, make sure the container goes too, not just the CLI.
		options.signal.addEventListener(
			"abort",
			() => {
				spawnSync("docker", ["kill", name], { stdio: "ignore" });
			},
			{ once: true },
		);
		return child;
	};
}

/** True when the operator has opted this process into Docker sandboxing. */
export function sandboxEnabled(): boolean {
	return process.env.ARNOLD_SANDBOX === "docker";
}

/**
 * The native `claude` binary the SDK would run. The SDK ships it as an optional
 * dependency next to itself (`claude-agent-sdk-linux-x64` and so on), so it is
 * found as a sibling of the SDK package. The path is resolved through symlinks
 * because the container mounts the real directory.
 */
export function resolveClaudeExecutable(): string {
	// Found on the file system, not through module resolution: bundlers rewrite
	// both `require.resolve` and `import.meta.url`, and neither is reliable inside
	// the Next server. pnpm links the SDK into the core package, and its platform
	// binary packages sit beside the real SDK directory.
	const sdkLink = path.join(
		repoRoot(),
		"packages",
		"core",
		"node_modules",
		"@anthropic-ai",
		"claude-agent-sdk",
	);
	const scope = path.dirname(realpathSync(sdkLink));
	const arch = process.arch === "arm64" ? "arm64" : "x64";
	for (const name of [`claude-agent-sdk-linux-${arch}`, `claude-agent-sdk-linux-${arch}-musl`]) {
		const candidate = path.join(scope, name, "claude");
		if (existsSync(candidate)) return realpathSync(candidate);
	}
	throw new ValidationError(
		"cannot find the native claude binary next to the Agent SDK; set pathToClaudeCodeExecutable",
		{ sdkLink },
	);
}
