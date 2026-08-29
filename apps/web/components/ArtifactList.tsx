/**
 * Purpose: the files a run kept. Every artifact links to its raw bytes at
 * /api/artifacts/<id>; markdown artifacts also expand inline, because the whole
 * point of an `artifacts`-scoped agent like pr-loop-analyzer is the report it
 * wrote, and making the operator download it to read it defeats that.
 *
 * Client component: the inline body is fetched when a panel is opened, never on
 * page load. A run can collect one report per PR, and eagerly loading them all
 * would pull the artifact store through the browser.
 */

"use client";

import { Accordion, AccordionItem, Button, Chip } from "@heroui/react";
import { Download, FileText, Paperclip, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Markdown } from "@/components/Markdown";
import { RelativeTime } from "@/components/RelativeTime";
import { formatBytes } from "@/components/format";
import { useArtifactText } from "@/hooks/useArtifactText";
import type { RunArtifactDto } from "@/components/types";

function isMarkdown(artifact: RunArtifactDto): boolean {
	return (
		artifact.mimeType === "text/markdown" ||
		artifact.path.endsWith(".md") ||
		artifact.kind === "report"
	);
}

function ArtifactBody({ artifactBodyArtifact }: { artifactBodyArtifact: RunArtifactDto }) {
	const { artifactTextContent, artifactTextLoading, artifactTextError, artifactTextReload } =
		useArtifactText({
			artifactTextArtifactId: artifactBodyArtifact.id,
			// Mounted only while its panel is open, so enabling on mount is the
			// "fetch on first open" behaviour.
			artifactTextEnabled: true,
		});

	if (artifactTextLoading) {
		return <p className="px-1 py-2 text-xs text-default-400">Loading artifact…</p>;
	}

	if (artifactTextError) {
		return (
			<div className="flex items-center gap-2 px-1 py-2 text-xs text-danger">
				<span>{artifactTextError}</span>
				<Button
					size="sm"
					variant="light"
					startContent={<RefreshCw className="h-3.5 w-3.5" />}
					onPress={artifactTextReload}
				>
					Retry
				</Button>
			</div>
		);
	}

	if (!artifactTextContent) {
		return <p className="px-1 py-2 text-xs text-default-400">Empty artifact.</p>;
	}

	return (
		<div className="arnold-scroll max-h-[32rem] overflow-y-auto rounded-medium bg-content2 px-3 py-2">
			<Markdown markdownSource={artifactTextContent} />
		</div>
	);
}

export function ArtifactList({
	artifactListArtifacts,
}: {
	artifactListArtifacts: RunArtifactDto[];
}) {
	const [artifactListOpenKeys, setArtifactListOpenKeys] = useState<Set<string>>(
		() => new Set<string>(),
	);

	if (artifactListArtifacts.length === 0) {
		return (
			<EmptyState
				emptyStateTitle="No artifacts"
				emptyStateDescription="This run kept no files. Read-only agents normally keep none; an agent scoped to artifacts that keeps none is worth a look."
				emptyStateIcon={<Paperclip className="h-5 w-5" />}
				emptyStateCompact
			/>
		);
	}

	const markdownArtifacts = artifactListArtifacts.filter(isMarkdown);
	const otherArtifacts = artifactListArtifacts.filter((artifact) => !isMarkdown(artifact));

	return (
		<div className="flex flex-col gap-3">
			{markdownArtifacts.length > 0 ? (
				<Accordion
					variant="bordered"
					selectionMode="multiple"
					selectedKeys={artifactListOpenKeys}
					onSelectionChange={(keys) =>
						// "all" arrives when every panel is expanded at once; it has to be
						// expanded into real ids, otherwise the string is spread per character.
						setArtifactListOpenKeys(
							keys === "all"
								? new Set(markdownArtifacts.map((artifact) => artifact.id))
								: new Set([...keys].map((key) => String(key))),
						)
					}
					itemClasses={{
						title: "text-sm",
						trigger: "py-3",
						content: "pb-3",
					}}
				>
					{markdownArtifacts.map((artifact) => (
						<AccordionItem
							key={artifact.id}
							aria-label={artifact.path}
							title={
								<span className="font-mono text-xs text-foreground">
									{artifact.path}
								</span>
							}
							subtitle={
								<span className="flex flex-wrap items-center gap-2 text-[11px] text-default-400">
									<Chip
										size="sm"
										variant="flat"
										classNames={{ content: "text-[10px]" }}
									>
										{artifact.kind}
									</Chip>
									<span>{formatBytes(artifact.sizeBytes)}</span>
									<RelativeTime relativeTimeIso={artifact.createdAt} />
									<a
										href={`/api/artifacts/${artifact.id}`}
										target="_blank"
										rel="noreferrer noopener"
										className="inline-flex items-center gap-1 text-primary hover:underline"
									>
										raw
										<Download className="h-3 w-3" />
									</a>
								</span>
							}
							startContent={<FileText className="h-4 w-4 text-default-400" />}
						>
							{/* Mounted only when open, which is what defers the fetch. */}
							{artifactListOpenKeys.has(artifact.id) ? (
								<ArtifactBody artifactBodyArtifact={artifact} />
							) : undefined}
						</AccordionItem>
					))}
				</Accordion>
			) : undefined}

			{otherArtifacts.length > 0 ? (
				<ul className="divide-y divide-divider rounded-large border border-default-200 bg-content1">
					{otherArtifacts.map((artifact) => (
						<li
							key={artifact.id}
							className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
						>
							<div className="flex min-w-0 items-center gap-2">
								<Paperclip className="h-4 w-4 shrink-0 text-default-400" />
								<span className="truncate font-mono text-xs text-foreground">
									{artifact.path}
								</span>
								<Chip
									size="sm"
									variant="flat"
									classNames={{ content: "text-[10px]" }}
								>
									{artifact.kind}
								</Chip>
							</div>
							<div className="flex items-center gap-3 text-[11px] text-default-400">
								<span className="font-mono">{artifact.mimeType}</span>
								<span>{formatBytes(artifact.sizeBytes)}</span>
								<a
									href={`/api/artifacts/${artifact.id}`}
									target="_blank"
									rel="noreferrer noopener"
									className="inline-flex items-center gap-1 text-primary hover:underline"
								>
									raw
									<Download className="h-3 w-3" />
								</a>
							</div>
						</li>
					))}
				</ul>
			) : undefined}
		</div>
	);
}
