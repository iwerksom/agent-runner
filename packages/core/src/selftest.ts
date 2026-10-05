/**
 * Purpose: prove the sandbox works before a held tier is released.
 *
 * A profile that exists is not a profile that holds: the image might be missing,
 * Docker might be misconfigured, or a mount might be wider than intended. So before
 * a run at a tier that needs the sandbox is accepted, a real container is started
 * with that tier's real profile and asked to do things it must not be able to do:
 * read a canary file that exists only outside its mounts, list the operator's
 * `~/.ssh`, find a database URL in its environment, write the root file system, and
 * (per tier) stage, commit or write where it should not. Any unexpected success
 * keeps the tier held.
 *
 * The result is cached for a while: a pass is trusted for fifteen minutes, a failure
 * for one, so a fixed setup recovers quickly and a broken one is not retried on every
 * click.
 */

import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { WriteScope } from "./agents.js";
import { repoRoot } from "./paths.js";
import {
	dockerArgs,
	profileFor,
	resolveClaudeExecutable,
	sandboxEnv,
	sandboxImageFor,
	type SandboxProfile,
} from "./sandbox.js";

const execFileAsync = promisify(execFile);

export type SelfTestResult = { ok: boolean; failures: string[]; at: number };

const PASS_TTL_MS = 15 * 60_000;
const FAIL_TTL_MS = 60_000;
const cache = new Map<string, SelfTestResult>();

/** The cached result when fresh, otherwise a new run. */
export async function ensureSandboxSelfTest(
	scope: WriteScope,
	repoSlug?: string,
): Promise<SelfTestResult> {
	// Per image: a repo's layer is a different container from the base.
	const key = `${scope}:${sandboxImageFor(repoSlug)}`;
	const cached = cache.get(key);
	if (cached !== undefined && Date.now() - cached.at < (cached.ok ? PASS_TTL_MS : FAIL_TTL_MS)) {
		return cached;
	}
	const result = await runSandboxSelfTest(scope, { repoSlug });
	cache.set(key, result);
	return result;
}

/** For tests: forget cached results. */
export function resetSandboxSelfTestCache(): void {
	cache.clear();
}

async function git(cwd: string, ...args: string[]): Promise<void> {
	await execFileAsync("git", args, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "selftest",
			GIT_AUTHOR_EMAIL: "selftest@localhost",
			GIT_COMMITTER_NAME: "selftest",
			GIT_COMMITTER_EMAIL: "selftest@localhost",
		},
	});
}

/** A subshell, so a redirection inside the command cannot swallow the probe's own. */
function probe(name: string, command: string): string {
	return `( ${command} ) >/dev/null 2>&1 && echo "${name}=yes" || echo "${name}=no"`;
}

export async function runSandboxSelfTest(
	scope: WriteScope,
	options: {
		tamper?: (profile: SandboxProfile) => SandboxProfile;
		/** Test the image this repo's runs use, not the base. */
		repoSlug?: string;
	} = {},
): Promise<SelfTestResult> {
	const failures: string[] = [];
	const finish = (): SelfTestResult => ({ ok: failures.length === 0, failures, at: Date.now() });

	const image = sandboxImageFor(options.repoSlug);
	const docker = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" });
	if (docker.status !== 0) {
		failures.push(`Docker or the ${image} image is not available (pnpm sandbox:build)`);
		return finish();
	}

	// Under the repo, not /tmp: a container's /tmp is its own, so a canary there
	// would be invisible for a reason that proves nothing.
	await mkdir(path.join(repoRoot(), ".arnold"), { recursive: true });
	const scratch = await mkdtemp(path.join(repoRoot(), ".arnold", "selftest-"));
	try {
		const remote = path.join(scratch, "remote.git");
		const seed = path.join(scratch, "seed");
		const mirror = path.join(scratch, "mirror.git");
		const tree = path.join(scratch, "tree");
		const canary = path.join(scratch, "canary");
		await git(scratch, "init", "--bare", "-b", "main", remote);
		await git(scratch, "clone", "-q", remote, seed);
		await writeFile(path.join(seed, "README.md"), "hello\n");
		await git(seed, "add", "-A");
		await git(seed, "commit", "-q", "-m", "seed");
		await git(seed, "push", "-q", "origin", "HEAD:main");
		// `--bare`, as the runner creates real mirrors.
		await git(scratch, "clone", "-q", "--bare", remote, mirror);
		await git(mirror, "worktree", "add", "-q", "--detach", tree, "main");
		await mkdir(canary, { recursive: true });
		await writeFile(path.join(canary, "secret.txt"), "CANARY\n");

		let profile = profileFor({
			manifest: {
				id: "selftest",
				writeScope: scope,
				artifactGlobs: scope === "artifacts" ? ["out/*.md"] : [],
				tools: { allowedTools: [], permissionMode: "default" },
			},
			workspacePath: tree,
			mirrorPath: mirror,
			claudeExecutable: resolveClaudeExecutable(),
			// The profile is built for the repo under test (so it picks that repo's
			// image) and the probe's own slug only matters for token lookup.
			repoSlug: options.repoSlug ?? "selftest",
			remoteUrl: remote,
		});
		if (options.tamper !== undefined) profile = options.tamper(profile);

		const envFile = path.join(scratch, "env");
		const env = sandboxEnv(profile, {
			ANTHROPIC_API_KEY: "selftest",
			DATABASE_URL: "selftest",
			GITHUB_TOKEN: "selftest",
		});
		await writeFile(
			envFile,
			Object.entries(env)
				.map(([k, v]) => `${k}=${v}`)
				.join("\n") + "\n",
		);

		const ssh = path.join(os.homedir(), ".ssh");
		const pushes =
			scope === "branch-push" || scope === "draft-pr" || scope === "external-writes";
		const lines = [
			probe("canary-read", `cat ${canary}/secret.txt`),
			probe("canary-list", `ls -A ${canary}`),
			probe("canary-grep", `grep -r CANARY ${scratch}`),
			probe("ssh", `ls ${ssh}`),
			probe("root-fs", "touch /etc/x"),
			probe("tree-write", `touch ${tree}/new-file`),
			`echo "uid=$(id -u)"`,
			`echo "secret-vars=$(env | grep -c '^DATABASE_URL=\\|^GITHUB_TOKEN=')"`,
		];
		if (scope === "artifacts") lines.push(probe("out-write", `touch ${tree}/out/ok.md`));
		if (scope === "working-tree") {
			lines.push(probe("git-add", `cd ${tree} && echo x >> README.md && git add README.md`));
			lines.push(probe("git-commit", `cd ${tree} && git commit -q -am x`));
		}
		if (pushes) {
			lines.push(
				probe(
					"git-commit",
					`cd ${tree} && git checkout -q -b st/x && echo x >> README.md && git commit -q -am x`,
				),
			);
			lines.push(
				probe("git-push", `cd ${tree} && git push -q origin HEAD:refs/heads/selftest`),
			);
		}

		const uid = process.getuid?.() ?? 1000;
		const gid = process.getgid?.() ?? 1000;
		const args = dockerArgs({
			name: `arnold-selftest-${process.pid}-${scope}-${options.repoSlug ?? "base"}`,
			profile,
			cwd: tree,
			envFile,
			command: "sh",
			args: ["-c", lines.join("; ")],
			uid,
			gid,
		});
		let stdout = "";
		try {
			stdout = (await execFileAsync("docker", args, { maxBuffer: 1 << 20 })).stdout;
		} catch (caught) {
			failures.push(`the test container did not run: ${String(caught).slice(0, 200)}`);
			return finish();
		}
		const seen = new Map<string, string>();
		for (const line of stdout.split("\n")) {
			const [k, v] = line.split("=");
			if (k !== undefined && v !== undefined) seen.set(k, v);
		}
		const expect = (name: string, want: string, why: string) => {
			if (seen.get(name) !== want)
				failures.push(
					`${name}: expected ${want}, got ${seen.get(name) ?? "nothing"} (${why})`,
				);
		};

		for (const name of ["canary-read", "canary-list", "canary-grep"]) {
			expect(name, "no", "the sandbox must not see files outside its mounts");
		}
		if (existsSync(ssh)) expect("ssh", "no", "the operator's ~/.ssh must be unreachable");
		expect("root-fs", "no", "the root file system must be read-only");
		expect("secret-vars", "0", "no database URL or token may be in the environment");
		if (seen.get("uid") !== String(uid) || uid === 0)
			failures.push("uid: must be the host user, not root");

		if (scope === "read-only" || scope === "artifacts")
			expect("tree-write", "no", "the worktree is read-only");
		if (scope === "artifacts")
			expect("out-write", "yes", "the artifact directory must be writable");
		if (scope === "working-tree") {
			expect("tree-write", "yes", "the worktree is writable");
			expect("git-add", "no", "staging must fail: the mirror is read-only");
			expect("git-commit", "no", "a commit must fail: the mirror is read-only");
		}
		if (pushes) {
			expect("tree-write", "yes", "the worktree is writable");
			expect("git-commit", "yes", "a commit must succeed at this tier");
			expect("git-push", "yes", "a push must reach the remote at this tier");
		}
		return finish();
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
