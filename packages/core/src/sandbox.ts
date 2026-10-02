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
 * `read-only`, `artifacts`, `working-tree`, `branch-push` and `draft-pr` have a
 * profile. `external-writes` throws from `profileFor`, so a tier without a profile
 * cannot run sandboxed by accident.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SpawnedProcess, SpawnOptions } from "@anthropic-ai/claude-agent-sdk";
import type { AgentManifest } from "./agents.js";
import { ValidationError } from "./errors.js";
import { githubRepoFromRemote } from "./filing.js";
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
	/** The repo's slug, to look up a per-repo push token. */
	repoSlug?: string;
	/** The repo's real remote. Pushes go here, not to the mirror's local origin. */
	remoteUrl?: string;
};

/** Where a push from inside the sandbox lands. */
export type PushTarget = { kind: "https"; url: string } | { kind: "path"; path: string };

/**
 * The repo's real remote as a push target. A GitHub remote becomes its https URL
 * (a token authenticates it); a local path or `file://` URL is a path the container
 * must mount writable. Anything else (ssh to another host, say) has no profile.
 *
 * This is separate from the mirror's own `origin`, which is the operator's local
 * checkout: the mirror is cloned from it so runs need no network, which means a
 * plain `git push origin` would land in that checkout and never reach the forge.
 */
export function pushTargetOf(remoteUrl: string): PushTarget | undefined {
	const github = githubRepoFromRemote(remoteUrl);
	if (github !== undefined) return { kind: "https", url: `https://github.com/${github}.git` };
	if (remoteUrl.startsWith("file://")) return { kind: "path", path: fileURLToPath(remoteUrl) };
	if (path.isAbsolute(remoteUrl)) return { kind: "path", path: remoteUrl };
	return undefined;
}

/** A worktree's git admin directory (index, HEAD), named by its `.git` file. */
export function gitAdminDirOf(workspacePath: string): string {
	const file = readFileSync(path.join(workspacePath, ".git"), "utf8").trim();
	const match = /^gitdir:\s*(.+)$/.exec(file);
	if (match?.[1] === undefined) {
		throw new ValidationError(`${workspacePath}/.git is not a worktree pointer`, {
			workspacePath,
		});
	}
	return path.resolve(workspacePath, match[1]);
}

/** The push token for a repo: `ARNOLD_GH_PUSH_TOKEN_<SLUG>` first, then the shared one. */
function pushTokenFor(repoSlug: string | undefined): string | undefined {
	const specific =
		repoSlug === undefined
			? undefined
			: process.env[
					`ARNOLD_GH_PUSH_TOKEN_${repoSlug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`
				];
	const token = specific ?? process.env.ARNOLD_GH_PUSH_TOKEN;
	return token === undefined || token === "" ? undefined : token;
}

export function profileFor(input: ProfileInput): SandboxProfile {
	const { manifest, workspacePath, mirrorPath, claudeExecutable } = input;
	const scope = manifest.writeScope;
	if (scope === "external-writes") {
		throw new ValidationError(
			`no sandbox profile for write scope ${scope} yet (agent ${manifest.id})`,
			{ agentId: manifest.id, writeScope: scope },
		);
	}
	const claudeDir = path.dirname(claudeExecutable);
	const envSet: Record<string, string> = {
		HOME: "/tmp/home",
		PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
	};
	// Same absolute paths inside and outside: a git worktree records absolute paths
	// to its admin directory, and transcripts and provenance must agree on where
	// files are.
	let mounts: SandboxMount[];

	if (scope === "read-only" || scope === "artifacts") {
		mounts = [
			{ host: workspacePath, container: workspacePath, writable: false },
			{ host: mirrorPath, container: mirrorPath, writable: false },
			{ host: claudeDir, container: claudeDir, writable: false },
		];
		if (scope === "artifacts") {
			for (const glob of manifest.artifactGlobs) {
				const host = path.join(workspacePath, artifactDirOf(glob));
				mkdirSync(host, { recursive: true });
				if (!mounts.some((m) => m.container === host)) {
					mounts.push({ host, container: host, writable: true });
				}
			}
		}
	} else if (scope === "working-tree") {
		// Writable files, and the worktree's own admin directory so git can read and
		// refresh its index. The rest of the mirror stays read-only, so objects and
		// shared refs cannot be written: `git commit` fails at the file system even
		// though the scope also forbids it in the gate.
		mounts = [
			{ host: workspacePath, container: workspacePath, writable: true },
			{ host: mirrorPath, container: mirrorPath, writable: false },
			{
				host: gitAdminDirOf(workspacePath),
				container: gitAdminDirOf(workspacePath),
				writable: true,
			},
			{ host: claudeDir, container: claudeDir, writable: false },
		];
	} else {
		// branch-push and draft-pr: commits and pushes. The mirror is writable so
		// commits can land, and a push goes to the repo's real remote (see
		// `pushTargetOf`), authenticated by a token that exists for this tier only.
		if (input.remoteUrl === undefined) {
			throw new ValidationError(
				`write scope ${scope} (agent ${manifest.id}) needs the repo's remote to push to`,
				{ agentId: manifest.id },
			);
		}
		const target = pushTargetOf(input.remoteUrl);
		if (target === undefined) {
			throw new ValidationError(
				`cannot push to ${input.remoteUrl} from the sandbox: only GitHub and local remotes are supported`,
				{ agentId: manifest.id, remoteUrl: input.remoteUrl },
			);
		}
		mounts = [
			{ host: workspacePath, container: workspacePath, writable: true },
			{ host: mirrorPath, container: mirrorPath, writable: true },
			{ host: claudeDir, container: claudeDir, writable: false },
		];
		const gitConfig: [string, string][] = [];
		if (target.kind === "https") {
			const token = pushTokenFor(input.repoSlug);
			if (token === undefined) {
				throw new ValidationError(
					`write scope ${scope} (agent ${manifest.id}) needs a push token: set ARNOLD_GH_PUSH_TOKEN, or ARNOLD_GH_PUSH_TOKEN_${(input.repoSlug ?? "REPO").toUpperCase().replace(/[^A-Z0-9]/g, "_")} for this repo only`,
					{ agentId: manifest.id },
				);
			}
			envSet.GH_TOKEN = token;
			gitConfig.push(["remote.origin.pushurl", target.url]);
			gitConfig.push(["credential.https://github.com.helper", "!gh auth git-credential"]);
		} else {
			mounts.push({ host: target.path, container: target.path, writable: true });
			gitConfig.push(["remote.origin.pushurl", target.path]);
		}
		// Git reads configuration from the environment, so nothing is written to disk.
		envSet.GIT_CONFIG_COUNT = String(gitConfig.length);
		gitConfig.forEach(([key, value], i) => {
			envSet[`GIT_CONFIG_KEY_${i}`] = key;
			envSet[`GIT_CONFIG_VALUE_${i}`] = value;
		});
		envSet.GIT_TERMINAL_PROMPT = "0";
	}

	if (scope === "working-tree" || scope === "branch-push" || scope === "draft-pr") {
		// Commits need an identity; without one git refuses.
		const name = process.env.ARNOLD_GIT_NAME ?? "Arnold";
		const email = process.env.ARNOLD_GIT_EMAIL ?? "arnold@localhost";
		envSet.GIT_AUTHOR_NAME = name;
		envSet.GIT_COMMITTER_NAME = name;
		envSet.GIT_AUTHOR_EMAIL = email;
		envSet.GIT_COMMITTER_EMAIL = email;
	}

	// A read-only forge token, only for the read tiers whose allow-list uses `gh`,
	// and only from a variable the operator set for exactly this purpose.
	if (scope === "read-only" || scope === "artifacts" || scope === "working-tree") {
		const usesGh = manifest.tools.allowedTools.some((t) => /^Bash\(gh\b/.test(t));
		const forgeToken = process.env.ARNOLD_GH_READ_TOKEN;
		if (usesGh && forgeToken !== undefined && forgeToken !== "") envSet.GH_TOKEN = forgeToken;
	}

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
