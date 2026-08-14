/**
 * Purpose: smoke-test the two modules that have no database dependency, against
 * the REAL prompt files in the diamond_frontend checkout. These are the parts
 * most likely to be silently wrong: a prompt whose `<PR>` token never got
 * substituted still runs, it just analyses the wrong PR, and a tool policy that
 * fails open looks identical to one that works until an agent writes something.
 *
 * Run: npx tsx scripts/smoke.ts <path-to-diamond_frontend-checkout>
 * Exits non-zero on the first failed assertion.
 */

import {
	isRunAuthoredArtifact,
	resolveReportVerdict,
	snapshotArtifacts,
} from "../packages/core/src/collect.js";
import { atLeast } from "../packages/core/src/agents.js";
import { extractTicketKeys } from "../packages/core/src/notary.js";
import { renderPrompt, validateArgs } from "../packages/core/src/prompt.js";
import { buildCanUseTool } from "../packages/core/src/writeScope.js";
import { manifest as aiSmellScan } from "../registry/diamond-frontend/ai-smell-scan.js";
import { manifest as fixPrComments } from "../registry/diamond-frontend/fix-pr-comments.js";
import { manifest as analyzerSubagent } from "../registry/diamond-frontend/pr-loop-analyzer-subagent.js";
import { manifest as analyzer } from "../registry/diamond-frontend/pr-loop-analyzer.js";
import { manifest as prePrReview } from "../registry/diamond-frontend/pre-pr-review.js";
import { manifest as planWeek } from "../registry/diamond-frontend/plan-week.js";
import { manifest as scoper } from "../registry/diamond-frontend/work-order-scoper.js";
import { manifest as workQueue } from "../registry/diamond-frontend/work-queue.js";

const checkout = process.argv[2];
if (checkout === undefined) {
	console.error("usage: tsx scripts/smoke.ts <path-to-diamond_frontend-checkout>");
	process.exit(2);
}

let failures = 0;
function check(label: string, condition: boolean, detail?: string): void {
	if (condition) {
		console.log(`  ok    ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL  ${label}${detail === undefined ? "" : `\n        ${detail}`}`);
	}
}

console.log("\n[1] prompt rendering: pr-loop-analyzer uses the literal token <PR>, not $1");
{
	const resolved = validateArgs(analyzer, { prNumber: "1234" });
	check("validateArgs resolves prNumber", resolved.prNumber === "1234");

	const rendered = await renderPrompt(analyzer, { prNumber: "1234" }, checkout);
	const body = rendered.promptBody;
	check("prompt body is non-trivial", body.length > 500, `length ${body.length}`);
	check("no <PR> token survives substitution", !body.includes("<PR>"));
	check("the PR number is present", body.includes("1234"));
	check("frontmatter was stripped", !body.trimStart().startsWith("---"));
}

console.log("\n[2] prompt rendering: work-order-scoper gets a rebuilt context block");
{
	const rendered = await renderPrompt(
		scoper,
		{
			woNumber: "3",
			ticketKey: "DAP-999",
			issueText: "Rename the thing. Acceptance: the thing is renamed.",
			windowMinutes: "75",
			hotFiles: "src/app/foo.tsx",
		},
		checkout,
	);
	const body = rendered.promptBody;
	check("context template was appended", body.includes("## Your assignment"));
	check("woNumber substituted", body.includes("WO-3"));
	check("ticketKey substituted", body.includes("DAP-999"));
	check("windowMinutes substituted", body.includes("75"));
	check("issueText substituted", body.includes("the thing is renamed"));
	check("no unfilled {{placeholders}} remain", !/\{\{\w+\}\}/.test(body));
	check(
		"declaredTools was read from the subagent frontmatter",
		(rendered.declaredTools ?? []).includes("Read"),
		`got ${JSON.stringify(rendered.declaredTools)}`,
	);
}

console.log("\n[3] prompt rendering: a missing required argument is refused");
{
	let threw = false;
	try {
		await renderPrompt(analyzer, {}, checkout);
	} catch {
		threw = true;
	}
	check("missing prNumber throws instead of rendering a broken prompt", threw);
}

console.log("\n[4] write scope: read-only work-order-scoper cannot write");
{
	const canUse = buildCanUseTool({
		manifest: scoper,
		workspacePath: checkout,
		declaredTools: ["Read", "Grep", "Glob", "Bash"],
	});
	const write = await canUse("Write", { file_path: `${checkout}/src/app/x.tsx`, content: "x" });
	check("Write denied", write.behavior === "deny");
	const edit = await canUse("Edit", { file_path: `${checkout}/README.md` });
	check("Edit denied", edit.behavior === "deny");
	const read = await canUse("Read", { file_path: `${checkout}/README.md` });
	check("Read allowed", read.behavior === "allow");
	const gitLog = await canUse("Bash", { command: "git log --oneline -5" });
	check("Bash(git log) allowed", gitLog.behavior === "allow");
	const gitPush = await canUse("Bash", { command: "git push origin HEAD" });
	check("Bash(git push) denied", gitPush.behavior === "deny");
	const chained = await canUse("Bash", { command: "git log --oneline && rm -rf src" });
	check("a chained command is not smuggled past the allow-list", chained.behavior === "deny");
}

console.log("\n[5] write scope: artifacts-scoped pr-loop-analyzer writes only its report");
{
	const canUse = buildCanUseTool({ manifest: analyzer, workspacePath: checkout });
	const report = await canUse("Write", {
		file_path: `${checkout}/.pr-loop/reports/PR-1234-analyzer.md`,
		content: "x",
	});
	check("Write inside .pr-loop/reports allowed", report.behavior === "allow");
	const source = await canUse("Write", {
		file_path: `${checkout}/src/app/page.tsx`,
		content: "x",
	});
	check("Write into src denied", source.behavior === "deny");
	const claudeDir = await canUse("Write", {
		file_path: `${checkout}/.claude/commands/pr-loop-analyzer.md`,
		content: "x",
	});
	check("Write into .claude denied by the global rule", claudeDir.behavior === "deny");
	const env = await canUse("Write", { file_path: `${checkout}/.env.local`, content: "x" });
	check("Write into .env.local denied by the global rule", env.behavior === "deny");
	const escape = await canUse("Write", { file_path: "/etc/passwd", content: "x" });
	check("Write outside the workspace denied", escape.behavior === "deny");
	const traversal = await canUse("Write", {
		file_path: `${checkout}/.pr-loop/reports/../../../../etc/passwd`,
		content: "x",
	});
	check("path traversal denied", traversal.behavior === "deny");
}

console.log("\n[6] artifact scoping: a run claims its own output, not the checkout's");
{
	// Run against the real checkout, because that is where this failed:
	// `.pr-loop/reports/PR-*.md` is dozens of tracked files in diamond_frontend,
	// and collecting all of them attributed seven reports to a run that wrote one.
	const globs = analyzer.artifactGlobs;
	const baseline = await snapshotArtifacts(checkout, globs);
	check(
		"the checkout already matches the analyzer's globs",
		baseline.size > 1,
		`${baseline.size} match(es)`,
	);

	const [existingPath] = [...baseline.keys()];
	if (existingPath === undefined) {
		check("a pre-existing report to test against", false, "no matches to sample");
	} else {
		const existingMtimeMs = baseline.get(existingPath) ?? 0;
		check(
			"an untouched pre-existing report is not claimed",
			!isRunAuthoredArtifact(baseline, existingPath, existingMtimeMs),
			existingPath,
		);
		check(
			"a rewritten pre-existing report is claimed",
			isRunAuthoredArtifact(baseline, existingPath, existingMtimeMs + 1000),
			existingPath,
		);
	}
	check(
		"a file the run creates is claimed",
		isRunAuthoredArtifact(baseline, ".pr-loop/reports/PR-999999-brand-new.md", Date.now()),
	);
	check(
		"no baseline collects everything, so the old behaviour is intact",
		isRunAuthoredArtifact(undefined, ".pr-loop/reports/PR-455-analyzer.md", 1),
	);
}

console.log("\n[7] global tool denial: PowerShell is refused ahead of the allow-list");
{
	const canUse = buildCanUseTool({ manifest: planWeek, workspacePath: checkout });
	// The command itself is one plan-week explicitly allows in Bash, so a denial
	// here can only come from the tool name.
	const shell = await canUse("PowerShell", { command: "git status --short" });
	check("PowerShell denied", shell.behavior === "deny");
	check(
		"the denial names the shell, not the scope",
		shell.behavior === "deny" && shell.message.includes("written in Bash"),
		shell.behavior === "deny" ? shell.message : "allowed",
	);
	const bash = await canUse("Bash", { command: "git status --short" });
	check("the same command through Bash is allowed", bash.behavior === "allow");
}

console.log("\n[8] mainBookkeeping: plan-week commits .week-plan/ to main and nothing else");
{
	// The reader is stubbed rather than driven off a real worktree: the decision
	// under test is "given these paths, allow or deny", and staging real files in
	// the checkout to test it would leave the smoke run with dirty state.
	const readerCalls: Array<[string, string | undefined]> = [];
	const gateWith = (touched: string[]) =>
		buildCanUseTool({
			manifest: planWeek,
			workspacePath: checkout,
			defaultBranch: "main",
			readBookkeepingPaths: async (_workspace, kind, againstRef) => {
				readerCalls.push([kind, againstRef]);
				return touched;
			},
		});

	const clean = gateWith([".week-plan/WEEK-2026-W34.md", ".week-plan/queue.jsonl"]);
	const good = await clean("Bash", { command: 'git commit -m "plan: week 34 [skip ci]"' });
	check("a commit of granted paths with [skip ci] is allowed", good.behavior === "allow");
	check(
		"a commit is vetted against the staged diff",
		readerCalls.at(-1)?.[0] === "staged",
		JSON.stringify(readerCalls.at(-1)),
	);
	const push = await clean("Bash", { command: "git push origin main" });
	check("pushing those commits to main is allowed", push.behavior === "allow");
	// The ref matters: a leased worktree is on a detached HEAD with no upstream and
	// no remote-tracking refs, so the diff has to name the branch explicitly.
	check(
		"a push is vetted against <target>..HEAD, not @{upstream}",
		readerCalls.at(-1)?.[0] === "unpushed" && readerCalls.at(-1)?.[1] === "main",
		JSON.stringify(readerCalls.at(-1)),
	);

	const noSkipCi = await clean("Bash", { command: 'git commit -m "plan: week 34"' });
	check("a commit without [skip ci] is denied", noSkipCi.behavior === "deny");
	const stagesAll = await clean("Bash", { command: 'git commit -am "plan: week 34 [skip ci]"' });
	check(
		"git commit -am is denied, because -a defeats the diff check",
		stagesAll.behavior === "deny",
	);
	const noMessage = await clean("Bash", { command: "git commit" });
	check("a commit with no -m is denied, having no message to vet", noMessage.behavior === "deny");
	// Denied by the allow-list before the grant is ever consulted, since plan-week
	// has no `Bash(git merge*)` entry. Asserted on the message so it stays obvious
	// which layer said no.
	const merge = await clean("Bash", { command: "git merge origin/main" });
	check("git merge is denied", merge.behavior === "deny");
	check(
		"and the denial names the allow-list rather than implying Bash is banned",
		merge.behavior === "deny" && merge.message.includes("entries are:"),
		merge.behavior === "deny" ? merge.message : "allowed",
	);

	const dirty = gateWith([".week-plan/WEEK-2026-W34.md", "src/app/page.tsx"]);
	const leaked = await dirty("Bash", { command: 'git commit -m "plan: week 34 [skip ci]"' });
	check("a commit touching src/ is denied", leaked.behavior === "deny");
	check(
		"the denial names the offending path",
		leaked.behavior === "deny" && leaked.message.includes("src/app/page.tsx"),
		leaked.behavior === "deny" ? leaked.message : "allowed",
	);
	const leakedPush = await dirty("Bash", { command: "git push origin main" });
	check("pushing a diff that touches src/ is denied", leakedPush.behavior === "deny");

	const empty = gateWith([]);
	const nothing = await empty("Bash", { command: 'git commit -m "plan [skip ci]"' });
	check("a commit with nothing staged is denied", nothing.behavior === "deny");
}

console.log("\n[9] mainBookkeeping applies above branch-push, where the tier test is satisfied");
{
	// work-queue sits at draft-pr, so `vcsMutationIn` never fires for it. Its push
	// to main is nonetheless gated, which is the whole reason the grant is
	// orthogonal to the tier — and its ordinary pushes to a WO branch must stay
	// untouched, or the gate has broken the agent it was meant to constrain.
	const gateWith = (touched: string[]) =>
		buildCanUseTool({
			manifest: workQueue,
			workspacePath: checkout,
			defaultBranch: "main",
			readBookkeepingPaths: async () => touched,
		});

	const featureBranch = await gateWith(["src/app/page.tsx"])("Bash", {
		command: "git push origin wo-3-rename-the-thing",
	});
	check(
		"a draft-pr agent still pushes freely to a feature branch",
		featureBranch.behavior === "allow",
		featureBranch.behavior === "deny" ? featureBranch.message : "",
	);

	const toMain = await gateWith(["src/app/page.tsx"])("Bash", {
		command: "git push origin main",
	});
	check("but a push of src/ to main is denied at draft-pr too", toMain.behavior === "deny");

	const bookkeeping = await gateWith([".week-plan/queue.jsonl"])("Bash", {
		command: "git push origin main",
	});
	check("while a push of .week-plan/ to main is allowed", bookkeeping.behavior === "allow");

	// A qualified refspec lands on main just as plainly as the bare name does, so
	// the destination side has to be read rather than the whole operand.
	const refspec = await gateWith(["src/app/page.tsx"])("Bash", {
		command: "git push origin HEAD:refs/heads/main",
	});
	check(
		"a fully qualified refspec is recognised as landing on main",
		refspec.behavior === "deny",
	);
}

console.log("\n[10] mainBookkeeping fails closed when it cannot read the diff");
{
	const noReader = buildCanUseTool({
		manifest: planWeek,
		workspacePath: checkout,
		defaultBranch: "main",
	});
	const unwired = await noReader("Bash", { command: 'git commit -m "plan [skip ci]"' });
	check("no reader wired up denies rather than allows", unwired.behavior === "deny");

	const throwingReader = buildCanUseTool({
		manifest: planWeek,
		workspacePath: checkout,
		defaultBranch: "main",
		readBookkeepingPaths: async () => {
			throw new Error("no upstream configured");
		},
	});
	const failed = await throwingReader("Bash", { command: "git push origin main" });
	check("a git failure in the reader denies rather than allows", failed.behavior === "deny");

	// scoper is read-only with no grant at all, which is the case that must stay
	// denied no matter how the bookkeeping path is wired.
	const readOnly = buildCanUseTool({
		manifest: scoper,
		workspacePath: checkout,
		declaredTools: ["Read", "Grep", "Glob", "Bash"],
		defaultBranch: "main",
		readBookkeepingPaths: async () => [".week-plan/x.md"],
	});
	const scoperPush = await readOnly("Bash", { command: "git push origin main" });
	check("a read-only agent with no grant is still denied", scoperPush.behavior === "deny");
}

console.log("\n[11] notary: a run records the ticket it was dispatched against");
{
	// Exactly what the runner builds: the declared arguments in manifest order,
	// scanned before the transcript.
	const dispatched: Record<string, string> = {
		woNumber: "2",
		ticketKey: "DAP-1690",
		issueText: "Knip blocks four orders. One of them, DAP-1298, parked on the knock-on.",
		windowMinutes: "90",
		hotFiles: "(none)",
	};
	const declaredArgValues = scoper.args
		.map((arg) => dispatched[arg.name])
		.filter((value): value is string => typeof value === "string");

	// The regression: the scoper answers in prose and need never repeat the key,
	// which recorded ticketKeys: null for a run wholly about DAP-1690.
	const silent = extractTicketKeys(
		...declaredArgValues,
		"REJECT: undecided-design. No key here.",
	);
	check(
		"the dispatched ticket is recorded even when the transcript omits it",
		silent[0] === "DAP-1690",
		`got ${JSON.stringify(silent)}`,
	);
	check("a ticket cited in the issue text is also captured", silent.includes("DAP-1298"));

	// Manifest order decides the lead: ticketKey is declared before issueText.
	const ordered = extractTicketKeys(...declaredArgValues, "DAP-9999 came up first in prose.");
	check(
		"the dispatched ticket leads the list",
		ordered[0] === "DAP-1690",
		`got ${JSON.stringify(ordered)}`,
	);
	check("transcript-only tickets still follow", ordered.includes("DAP-9999"));

	check(
		"keys are de-duplicated across sources",
		extractTicketKeys("DAP-1", "DAP-1 DAP-1").length === 1,
	);
	check(
		"absent sources are skipped",
		extractTicketKeys(undefined, "DAP-2", undefined).length === 1,
	);
	check("a run with nothing to record yields none", extractTicketKeys(undefined).length === 0);
}

console.log("\n[12] outcome parsing: a work order with no REJECT line is accepted, not unparsed");
{
	// Both specs come from the real manifests, so a manifest that loses its
	// fallbackOutcome fails here rather than silently charting every good work
	// order as a parse failure.
	const scoperSpec = scoper.outcome;
	const analyzerSpec = analyzer.outcome;
	if (scoperSpec?.kind !== "report" || analyzerSpec?.kind !== "report") {
		check("both manifests declare a report outcome", false);
	} else {
		check("work-order-scoper declares a fallback", scoperSpec.fallbackOutcome === "accepted");

		// The regression: the scoper announces only the negative case, so a good
		// work order contains no verdict line at all.
		const workOrder =
			"# WO-3 DAP-1688\n\n## Steps\n1. Declare resolve.alias.\n2. Run the e2e specs.\n";
		const accepted = resolveReportVerdict(
			scoperSpec.verdictPattern,
			scoperSpec.fallbackOutcome,
			workOrder,
		);
		check(
			"a work order with no REJECT line records accepted",
			accepted.verdictKind === "fallback" && accepted.verdictOutcome === "accepted",
			`got ${JSON.stringify(accepted)}`,
		);

		const rejected = resolveReportVerdict(
			scoperSpec.verdictPattern,
			scoperSpec.fallbackOutcome,
			"REJECT: undecided-design - no convention exists yet.",
		);
		check(
			"a REJECT line still parses to its reason code",
			rejected.verdictKind === "matched" && rejected.verdictOutcome === "undecided-design",
			`got ${JSON.stringify(rejected)}`,
		);
		check(
			"the reason code is one the manifest declares",
			rejected.verdictKind === "matched" &&
				scoper.reasonCodes.includes(rejected.verdictOutcome),
		);

		// A verdict of `hot-files: some-branch` carries outcome and reason both.
		const withReason = resolveReportVerdict(
			scoperSpec.verdictPattern,
			scoperSpec.fallbackOutcome,
			"REJECT: hot-files:DAP-1333-import-cleanup",
		);
		check(
			"a colon-suffixed verdict splits into outcome and reason",
			withReason.verdictKind === "matched" &&
				withReason.verdictOutcome === "hot-files" &&
				withReason.verdictReasonCode === "DAP-1333-import-cleanup",
			`got ${JSON.stringify(withReason)}`,
		);

		// pr-loop-analyzer declares no fallback, so a non-match must stay honest
		// rather than inventing a verdict.
		check("pr-loop-analyzer declares no fallback", analyzerSpec.fallbackOutcome === undefined);
		const noVerdict = resolveReportVerdict(
			analyzerSpec.verdictPattern,
			analyzerSpec.fallbackOutcome,
			"A report that never states a verdict.",
		);
		check(
			"without a fallback a non-match stays unparsed",
			noVerdict.verdictKind === "unparsed",
			`got ${JSON.stringify(noVerdict)}`,
		);
	}
}

console.log("\n[13] Phase 0 hold: nothing above `artifacts` may be triggerable");
{
	// The invariant, not a list of two names: Phase 3 gates triggering by role and
	// mounts credentials per tier, and until it lands anything that can write to a
	// working tree is pressable by anyone who can reach the console. Stated this
	// way so a NEW mutating manifest fails here rather than shipping runnable.
	const registered = [
		analyzer,
		planWeek,
		scoper,
		workQueue,
		prePrReview,
		aiSmellScan,
		fixPrComments,
		analyzerSubagent,
	];
	const mutating = registered.filter((manifest) => atLeast(manifest.writeScope, "working-tree"));
	check("there are mutating manifests to check", mutating.length > 0, `${mutating.length} found`);
	for (const manifest of mutating) {
		check(
			`${manifest.id} (${manifest.writeScope}) is held until Phase 3`,
			manifest.disabled !== undefined,
			"a manifest above `artifacts` must declare `disabled` while the console has no auth",
		);
		check(
			`${manifest.id} says why, not just that`,
			(manifest.disabled?.reason ?? "").length > 20,
			`got ${JSON.stringify(manifest.disabled?.reason)}`,
		);
	}
	// The two that carry Phase 0 must stay pressable, or the hold has overreached.
	check("work-order-scoper is still runnable", scoper.disabled === undefined);
	check("pr-loop-analyzer is still runnable", analyzer.disabled === undefined);
}

console.log(
	failures === 0 ? "\nAll smoke checks passed.\n" : `\n${failures} smoke check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
