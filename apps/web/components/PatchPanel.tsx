/**
 * Purpose: a `working-tree` run's changes, as Arnold stored them (feature 3.2).
 * Shows the files and the diff, and one button that applies the patch to the
 * repo's checkout. The button is disabled with the reason whenever applying would
 * not be safe: the wrong branch, a dirty tree, a patch that no longer fits.
 *
 * It never commits and never switches branches; that is core's rule (changes.ts),
 * and this panel only reports it.
 */

"use client";

import { Button, Chip } from "@heroui/react";
import { Check, Copy, FileDiff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RelativeTime } from "@/components/RelativeTime";
import { formatBytes } from "@/components/format";
import type { ApiErrorBody, RunArtifactDto } from "@/components/types";
import { useArtifactText } from "@/hooks/useArtifactText";

type ApplyStatus = {
	canApply: boolean;
	reason?: string;
	command: string;
	appliedAt?: string;
};

function filesOf(patchText: string): string[] {
	return [...patchText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map(
		(match) => match[2] ?? "",
	);
}

function diffLineClass(line: string): string {
	if (line.startsWith("+") && !line.startsWith("+++")) return "text-success";
	if (line.startsWith("-") && !line.startsWith("---")) return "text-danger";
	if (line.startsWith("@@")) return "text-primary";
	return "text-default-500";
}

export function PatchPanel({ patchPanelArtifact }: { patchPanelArtifact: RunArtifactDto }) {
	const router = useRouter();
	const [status, setStatus] = useState<ApplyStatus | undefined>(undefined);
	const [statusError, setStatusError] = useState<string | undefined>(undefined);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const [copied, setCopied] = useState(false);
	const { artifactTextContent, artifactTextLoading } = useArtifactText({
		artifactTextArtifactId: patchPanelArtifact.id,
		artifactTextEnabled: true,
	});

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(`/api/artifacts/${patchPanelArtifact.id}/apply`, {
					signal: controller.signal,
				});
				if (!response.ok) {
					setStatusError(`Could not check the checkout (HTTP ${response.status}).`);
					return;
				}
				const body = (await response.json()) as { status: ApplyStatus };
				setStatus(body.status);
			} catch (caught) {
				if (!controller.signal.aborted) {
					setStatusError(caught instanceof Error ? caught.message : "Check failed.");
				}
			}
		})();
		return () => controller.abort();
	}, [patchPanelArtifact.id, patchPanelArtifact.appliedAt]);

	async function apply() {
		setPending(true);
		setError(undefined);
		try {
			const response = await fetch(`/api/artifacts/${patchPanelArtifact.id}/apply`, {
				method: "POST",
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => undefined)) as
					ApiErrorBody | undefined;
				setError(body?.error ?? `Apply failed with HTTP ${response.status}.`);
				return;
			}
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Apply request failed.");
		} finally {
			setPending(false);
		}
	}

	async function copyCommand() {
		if (status === undefined) return;
		try {
			await navigator.clipboard.writeText(status.command);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard can be blocked; the command is on screen to select.
		}
	}

	const files = artifactTextContent === undefined ? [] : filesOf(artifactTextContent);
	const applied = status?.appliedAt ?? patchPanelArtifact.appliedAt;

	return (
		<section className="flex flex-col gap-3 rounded-large border border-default-200 bg-content1 p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<FileDiff className="h-4 w-4 text-default-400" />
					<span className="text-sm font-medium text-foreground">Changes</span>
					<span className="text-[11px] text-default-400">
						{files.length > 0 ? `${files.length} file(s) · ` : ""}
						{formatBytes(patchPanelArtifact.sizeBytes)}
					</span>
					{applied ? (
						<Chip size="sm" variant="flat" color="success">
							applied <RelativeTime relativeTimeIso={applied} />
						</Chip>
					) : undefined}
				</div>
				<Button
					size="sm"
					color="primary"
					variant="flat"
					isLoading={pending}
					isDisabled={status === undefined || !status.canApply}
					onPress={() => void apply()}
				>
					Apply to checkout
				</Button>
			</div>

			{status !== undefined && !status.canApply && status.reason ? (
				<p className="text-xs text-default-500">{status.reason}</p>
			) : undefined}
			{statusError ? <p className="text-xs text-danger">{statusError}</p> : undefined}
			{error ? <p className="font-mono text-[11px] text-danger">{error}</p> : undefined}

			{files.length > 0 ? (
				<ul className="font-mono text-xs text-foreground">
					{files.map((file) => (
						<li key={file}>{file}</li>
					))}
				</ul>
			) : undefined}

			<details>
				<summary className="cursor-pointer text-xs text-primary">Show the diff</summary>
				<div className="arnold-scroll mt-2 max-h-[32rem] overflow-auto rounded-medium bg-content2 px-3 py-2">
					{artifactTextLoading ? (
						<p className="text-xs text-default-400">Loading…</p>
					) : (
						<pre className="font-mono text-[11px] leading-snug">
							{(artifactTextContent ?? "").split("\n").map((line, index) => (
								<div key={index} className={diffLineClass(line)}>
									{line === "" ? " " : line}
								</div>
							))}
						</pre>
					)}
				</div>
			</details>

			{status !== undefined ? (
				<div className="flex items-start gap-2">
					<code className="min-w-0 flex-1 break-all rounded-medium bg-content2 px-2 py-1 font-mono text-[11px] text-default-600">
						{status.command}
					</code>
					<Button
						size="sm"
						variant="light"
						startContent={
							copied ? (
								<Check className="h-3.5 w-3.5" />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)
						}
						onPress={() => void copyCommand()}
					>
						{copied ? "Copied" : "Copy"}
					</Button>
				</div>
			) : undefined}
		</section>
	);
}
