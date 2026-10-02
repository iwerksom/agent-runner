/**
 * Purpose: file a reviewed finding as an issue on the repo's own GitHub tracker.
 *
 * This writes to the tracker, never to the repo, and it runs only when the
 * operator clicks "File issue" in the console: no agent calls it. That is what
 * keeps ledtraad's read-only promise intact while still getting findings onto
 * its board. `gh` is already authenticated on this machine, so no credential
 * is read or stored here.
 *
 * The issue's acceptance check is the finding's own measuring command: re-run
 * it and the document states the measured value. That is why doc-drift records
 * the command with every finding.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "./db.js";
import { NotFoundError, ValidationError } from "./errors.js";

const execFileAsync = promisify(execFile);

export const FINDING_LABEL = "finding";

/** Runs `gh`. Injected so the filing logic is testable without a network. */
export type GhRunner = (args: string[]) => Promise<string>;

const runGh: GhRunner = async (args) => {
	const { stdout } = await execFileAsync("gh", args, { timeout: 30_000 });
	return stdout;
};

/** "owner/repo" from an ssh or https GitHub remote, or undefined for anything else. */
export function githubRepoFromRemote(remoteUrl: string): string | undefined {
	const match =
		/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
			remoteUrl.trim(),
		);
	return match?.[1] !== undefined && match[2] !== undefined
		? `${match[1]}/${match[2]}`
		: undefined;
}

export interface FindingForIssue {
	id: string;
	file: string;
	line: number | null;
	claim: string;
	measured: string;
	command: string;
	verdict: string;
	note: string;
	sourceRunId: string;
	title: string;
}

export function buildIssue(f: FindingForIssue): { title: string; body: string } {
	const where = f.line === null ? f.file : `${f.file}:${f.line}`;
	const title = `Doc drift: ${f.title}`.slice(0, 200);
	const lines = [
		`Found by the \`doc-drift\` agent (run \`${f.sourceRunId}\`). Reviewed and filed by hand from the Arnold console.`,
		"",
		`**Where:** \`${where}\``,
		`**Document claims:** ${f.claim}`,
		`**Measured:** ${f.measured}`,
		`**Which is wrong:** ${f.verdict}`,
	];
	if (f.note !== "") lines.push(`**Note:** ${f.note}`);
	lines.push(
		"",
		"**Measuring command**",
		"",
		"```",
		f.command,
		"```",
		"",
		"**Acceptance check:** re-run the command above. The document states the value it prints (or the claim is gone).",
		"",
		`<sub>Arnold finding \`${f.id}\`</sub>`,
	);
	return { title, body: lines.join("\n") };
}

/** `gh issue create` prints the new issue's URL; the number is its last segment. */
export function parseIssueUrl(output: string): { url: string; number: number } | undefined {
	const match = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/.exec(output);
	return match?.[0] !== undefined && match[1] !== undefined
		? { url: match[0], number: Number(match[1]) }
		: undefined;
}

export async function fileFinding(findingId: string, gh: GhRunner = runGh) {
	const finding = await prisma.finding.findUnique({
		where: { id: findingId },
		include: { repo: true },
	});
	if (finding === null) throw new NotFoundError(`no finding ${findingId}`, { findingId });
	if (finding.state !== "open") {
		throw new ValidationError(
			finding.state === "filed"
				? `finding is already filed as #${finding.issueNumber ?? "?"}`
				: `finding is ${finding.state}, only an open finding can be filed`,
			{ findingId, state: finding.state },
		);
	}
	const ghRepo = githubRepoFromRemote(finding.repo.remoteUrl);
	if (ghRepo === undefined) {
		throw new ValidationError(
			`repo ${finding.repo.slug} has no GitHub remote (${finding.repo.remoteUrl}), so there is no tracker to file on`,
			{ findingId },
		);
	}

	// Claim the finding before talking to GitHub: a second click then finds it
	// "filing" and is refused, instead of creating a duplicate issue.
	const claimed = await prisma.finding.updateMany({
		where: { id: findingId, state: "open" },
		data: { state: "filing" },
	});
	if (claimed.count === 0) {
		throw new ValidationError("finding is already being filed", { findingId });
	}

	try {
		const { title, body } = buildIssue(finding);
		const output = await gh([
			"issue",
			"create",
			"--repo",
			ghRepo,
			"--title",
			title,
			"--body",
			body,
			"--label",
			FINDING_LABEL,
		]);
		const issue = parseIssueUrl(output);
		if (issue === undefined) {
			// The issue may well exist; never revert to "open" and invite a second one.
			await prisma.finding.update({
				where: { id: findingId },
				data: { state: "filed", filedAt: new Date() },
			});
			throw new ValidationError(
				`gh created an issue but printed no URL I could read: ${output.trim().slice(0, 200)}`,
				{ findingId },
			);
		}
		return await prisma.finding.update({
			where: { id: findingId },
			data: {
				state: "filed",
				issueNumber: issue.number,
				issueUrl: issue.url,
				filedAt: new Date(),
			},
		});
	} catch (caught: unknown) {
		// gh failed before creating anything (auth, missing label, network): put it
		// back so the operator can retry. The unreadable-URL case above already
		// moved on to "filed" and is not reverted here.
		await prisma.finding.updateMany({
			where: { id: findingId, state: "filing" },
			data: { state: "open" },
		});
		if (caught instanceof ValidationError) throw caught;
		const reason = caught instanceof Error ? caught.message : String(caught);
		throw new ValidationError(`filing on ${ghRepo} failed: ${reason}`, { findingId });
	}
}
