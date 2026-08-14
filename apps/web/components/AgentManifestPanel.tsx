"use client";

/*
 * Client component on purpose. HeroUI's Table is built on React Aria's
 * collection builder, which walks its children and requires real elements.
 * Rendered from a Server Component it throws
 * "Unknown element <[object Object]> in collection".
 * The only prop is a serialisable AgentSummary, so the boundary is cheap.
 */

/**
 * Purpose: render one agent's manifest so it can be read and checked. The
 * argument table is the important part: slot, type, required and description
 * side by side, because a wrong slot is the most likely silent breakage — the
 * prompt reads a token and will happily run with the wrong value substituted.
 *
 * Everything else is here for the same reason: a bare `Bash` in the allow-list, a
 * required state path that does not exist, or an artifact glob that matches
 * nothing are all invisible until someone puts them on a screen next to each
 * other.
 *
 * Fields the list endpoint does not return render as an explicit "not exposed"
 * line rather than as an empty section, so a thin payload cannot be mistaken for
 * a permissive manifest.
 */

import {
	Chip,
	Table,
	TableBody,
	TableCell,
	TableColumn,
	TableHeader,
	TableRow,
} from "@heroui/react";
import {
	Ban,
	FolderTree,
	Info,
	Puzzle,
	ScrollText,
	Server,
	SlidersHorizontal,
	TriangleAlert,
	Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { ExecutionModeBadge, ScopeEnforcementBadge, WriteScopeBadge } from "@/components/badges";
import type { AgentSummary } from "@/components/types";

function Section({
	sectionTitle,
	sectionIcon,
	sectionAside,
	children,
}: {
	sectionTitle: string;
	sectionIcon: ReactNode;
	sectionAside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="rounded-large border border-default-200 bg-content1">
			<header className="flex flex-wrap items-center justify-between gap-2 border-b border-divider px-4 py-2.5">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					<span className="text-default-400">{sectionIcon}</span>
					{sectionTitle}
				</h2>
				{sectionAside}
			</header>
			<div className="px-4 py-3">{children}</div>
		</section>
	);
}

function NotExposed({ notExposedWhat }: { notExposedWhat: string }) {
	return (
		<p className="text-xs text-default-400">
			{notExposedWhat} is not exposed by /api/agents for this agent.
		</p>
	);
}

function PathList({ pathListItems }: { pathListItems: string[] }) {
	return (
		<ul className="flex flex-wrap gap-1.5">
			{pathListItems.map((item) => (
				<li
					key={item}
					className="rounded bg-content2 px-2 py-1 font-mono text-[11px] text-default-700"
				>
					{item}
				</li>
			))}
		</ul>
	);
}

export function AgentManifestPanel({ agentManifestAgent }: { agentManifestAgent: AgentSummary }) {
	const agent = agentManifestAgent;
	const tools = agent.tools;
	// A bare "Bash" (no parenthesised pattern) means the declared write scope is
	// not enforced by the allow-list, whatever scopeEnforcement claims.
	const unrestrictedTools = (tools?.allowedTools ?? []).filter((tool) =>
		/^(Bash|Write|Edit|MultiEdit)$/.test(tool),
	);

	return (
		<div className="flex flex-col gap-4">
			{agent.notes.length > 0 ? (
				<section className="flex flex-col gap-2">
					{agent.notes.map((note, index) => (
						<div
							key={`${index}-${note.slice(0, 24)}`}
							className="flex gap-2 rounded-large border border-default-200 bg-content2 p-3 text-xs text-default-600"
						>
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-default-400" />
							<p>{note}</p>
						</div>
					))}
				</section>
			) : undefined}

			<Section
				sectionTitle="Arguments"
				sectionIcon={<SlidersHorizontal className="h-4 w-4" />}
				sectionAside={
					<span className="text-[11px] text-default-400">
						{agent.args.length} argument{agent.args.length === 1 ? "" : "s"}
					</span>
				}
			>
				{agent.args.length === 0 ? (
					<p className="text-xs text-default-400">This agent takes no arguments.</p>
				) : (
					<Table
						aria-label={`${agent.name} arguments`}
						removeWrapper
						classNames={{
							th: "bg-content2 text-[10px] uppercase tracking-wider text-default-500",
							td: "border-b border-divider/60 py-2 align-top text-xs",
						}}
					>
						<TableHeader>
							<TableColumn>Name</TableColumn>
							<TableColumn>Slot</TableColumn>
							<TableColumn>Type</TableColumn>
							<TableColumn>Required</TableColumn>
							<TableColumn>Default</TableColumn>
							<TableColumn>Description</TableColumn>
						</TableHeader>
						<TableBody>
							{agent.args.map((arg) => (
								<TableRow key={arg.name}>
									<TableCell>
										<span className="font-mono text-[11px] font-medium text-foreground">
											{arg.name}
										</span>
									</TableCell>
									<TableCell>
										<code className="rounded bg-content3 px-1.5 py-0.5 font-mono text-[11px] text-default-700">
											{arg.slot}
										</code>
									</TableCell>
									<TableCell>
										<span className="font-mono text-[11px] text-default-500">
											{arg.type}
										</span>
									</TableCell>
									<TableCell>
										{arg.required ? (
											<Chip
												size="sm"
												variant="flat"
												color="primary"
												classNames={{ content: "text-[10px]" }}
											>
												required
											</Chip>
										) : (
											<span className="text-default-400">optional</span>
										)}
									</TableCell>
									<TableCell>
										{arg.default !== undefined ? (
											<span className="font-mono text-[11px] text-default-600">
												{arg.default}
											</span>
										) : (
											<span className="text-default-400">—</span>
										)}
									</TableCell>
									<TableCell>
										<span className="text-default-500">{arg.description}</span>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</Section>

			<Section
				sectionTitle="Tool policy"
				sectionIcon={<Wrench className="h-4 w-4" />}
				sectionAside={
					<div className="flex items-center gap-1.5">
						<WriteScopeBadge writeScope={agent.writeScope} />
						<ScopeEnforcementBadge scopeEnforcement={agent.scopeEnforcement} />
						<ExecutionModeBadge executionMode={agent.execution} />
					</div>
				}
			>
				{tools ? (
					<div className="flex flex-col gap-3">
						<div className="flex flex-col gap-1.5">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Allow-list
							</span>
							<ul className="flex flex-wrap gap-1.5">
								{tools.allowedTools.map((tool) => {
									const unrestricted = unrestrictedTools.includes(tool);
									return (
										<li key={tool}>
											<Chip
												size="sm"
												variant={unrestricted ? "solid" : "flat"}
												color={unrestricted ? "warning" : "default"}
												classNames={{ content: "font-mono text-[11px]" }}
											>
												{tool}
											</Chip>
										</li>
									);
								})}
							</ul>
							{unrestrictedTools.length > 0 ? (
								<p className="flex items-start gap-1.5 text-[11px] text-warning-600">
									<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<span>
										{unrestrictedTools.join(", ")} carries no pattern, so the
										declared write scope is not enforced by this allow-list.
										Narrow it.
									</span>
								</p>
							) : undefined}
						</div>

						<div className="flex flex-wrap gap-6">
							<div className="flex flex-col gap-1">
								<span className="text-[10px] uppercase tracking-wider text-default-400">
									Permission mode
								</span>
								<Chip
									size="sm"
									variant="flat"
									color={
										tools.permissionMode === "bypassPermissions"
											? "danger"
											: "default"
									}
									classNames={{ content: "font-mono text-[11px]" }}
								>
									{tools.permissionMode}
								</Chip>
							</div>

							<div className="flex flex-col gap-1">
								<span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-default-400">
									<Server className="h-3 w-3" />
									MCP servers
								</span>
								{tools.mcpServers && tools.mcpServers.length > 0 ? (
									<PathList pathListItems={tools.mcpServers} />
								) : (
									<span className="text-xs text-default-400">none</span>
								)}
							</div>
						</div>

						{tools.deniedPaths && tools.deniedPaths.length > 0 ? (
							<div className="flex flex-col gap-1.5">
								<span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-default-400">
									<Ban className="h-3 w-3" />
									Extra denied paths
								</span>
								<PathList pathListItems={tools.deniedPaths} />
							</div>
						) : undefined}
					</div>
				) : (
					<NotExposed notExposedWhat="The tool policy" />
				)}
			</Section>

			<Section
				sectionTitle="Files and state"
				sectionIcon={<FolderTree className="h-4 w-4" />}
			>
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] uppercase tracking-wider text-default-400">
							Artifact globs
						</span>
						{agent.artifactGlobs === undefined ? (
							<NotExposed notExposedWhat="The artifact glob list" />
						) : agent.artifactGlobs.length === 0 ? (
							<span className="text-xs text-default-400">
								none — this run keeps no files
							</span>
						) : (
							<PathList pathListItems={agent.artifactGlobs} />
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] uppercase tracking-wider text-default-400">
							State paths
						</span>
						{agent.statePaths === undefined ? (
							<NotExposed notExposedWhat="The state path list" />
						) : agent.statePaths.length === 0 ? (
							<span className="text-xs text-default-400">
								none — this agent carries no state between runs
							</span>
						) : (
							<ul className="flex flex-col gap-2">
								{agent.statePaths.map((statePath) => (
									<li
										key={statePath.path}
										className="flex flex-col gap-1 rounded-medium bg-content2 px-3 py-2"
									>
										<div className="flex flex-wrap items-center gap-2">
											<code className="font-mono text-[11px] text-foreground">
												{statePath.path}
											</code>
											<Chip
												size="sm"
												variant="flat"
												classNames={{ content: "text-[10px]" }}
											>
												{statePath.source}
											</Chip>
											<Chip
												size="sm"
												variant={statePath.required ? "solid" : "bordered"}
												color={statePath.required ? "warning" : "default"}
												classNames={{ content: "text-[10px]" }}
											>
												{statePath.required ? "required" : "optional"}
											</Chip>
										</div>
										{statePath.missingHint ? (
											<p className="text-[11px] text-default-500">
												{statePath.missingHint}
											</p>
										) : undefined}
									</li>
								))}
							</ul>
						)}
					</div>

					{agent.mainBookkeeping ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-[10px] uppercase tracking-wider text-warning-600">
								Main bookkeeping
							</span>
							<PathList pathListItems={agent.mainBookkeeping.paths} />
							<p className="text-[11px] text-default-500">
								Commits these paths straight to the default branch through the
								guarded push, which refuses unless every staged path matches and the
								commit carries [skip ci].
							</p>
						</div>
					) : undefined}
				</div>
			</Section>

			<Section
				sectionTitle="Outcome and reason codes"
				sectionIcon={<ScrollText className="h-4 w-4" />}
			>
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] uppercase tracking-wider text-default-400">
							Outcome spec
						</span>
						{agent.outcome ? (
							<code className="w-fit rounded bg-content2 px-2 py-1 font-mono text-[11px] text-default-700">
								{agent.outcome.kind === "json-block"
									? "json-block · last fenced json block of the final message"
									: agent.outcome.kind === "jsonl"
										? `jsonl · ${agent.outcome.path} (${agent.outcome.outcomeKey}${
												agent.outcome.reasonKey
													? `, ${agent.outcome.reasonKey}`
													: ""
											})`
										: `report · ${agent.outcome.pathGlob || "final message"} matching ${agent.outcome.verdictPattern}`}
							</code>
						) : (
							<p className="flex items-start gap-1.5 text-[11px] text-warning-600">
								<TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>
									No outcome spec. Runs of this agent cannot be charted, because
									nothing tells Arnold where the result is.
								</span>
							</p>
						)}
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-[10px] uppercase tracking-wider text-default-400">
							Reason codes
						</span>
						{agent.reasonCodes.length === 0 ? (
							<span className="text-xs text-default-400">none declared</span>
						) : (
							<ul className="flex flex-wrap gap-1.5">
								{agent.reasonCodes.map((code) => (
									<li key={code}>
										<Chip
											size="sm"
											variant="bordered"
											classNames={{ content: "font-mono text-[11px]" }}
										>
											{code}
										</Chip>
									</li>
								))}
							</ul>
						)}
						<p className="text-[11px] text-default-400">
							Kept per agent on purpose. Two agents can describe the same situation
							with different codes, and merging the vocabularies would split one
							concept across two labels in every chart.
						</p>
					</div>
				</div>
			</Section>

			<Section
				sectionTitle="Prompt and composition"
				sectionIcon={<Puzzle className="h-4 w-4" />}
			>
				<div className="flex flex-col gap-3 text-xs">
					<div className="flex flex-wrap gap-6">
						<div className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Prompt source
							</span>
							{agent.prompt ? (
								<code className="font-mono text-[11px] text-default-700">
									{agent.prompt.kind === "script"
										? `script · ${agent.prompt.command}`
										: `${agent.prompt.kind} · ${agent.prompt.path}`}
								</code>
							) : (
								<span className="text-default-400">not exposed</span>
							)}
						</div>

						<div className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Model
							</span>
							<span className="font-mono text-[11px] text-default-700">
								{agent.model ?? "workspace default"}
							</span>
						</div>

						<div className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Invocable
							</span>
							<span className="font-mono text-[11px] text-default-700">
								{agent.invocable}
							</span>
						</div>

						<div className="flex flex-col gap-1">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Schedule
							</span>
							<span className="font-mono text-[11px] text-default-700">
								{agent.defaultSchedule ?? "manual only"}
							</span>
						</div>
					</div>

					{agent.spawnsSubagents.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Spawns subagents
							</span>
							<PathList pathListItems={agent.spawnsSubagents} />
						</div>
					) : undefined}

					{agent.unattendedIfArgs && agent.unattendedIfArgs.length > 0 ? (
						<div className="flex flex-col gap-1.5">
							<span className="text-[10px] uppercase tracking-wider text-default-400">
								Unattended if supplied
							</span>
							<PathList pathListItems={agent.unattendedIfArgs} />
							<p className="text-[11px] text-default-500">
								Passing any of these removes the dependency that makes this agent
								need a human or a local session, so the Dispatcher will accept it
								headless.
							</p>
						</div>
					) : undefined}

					{agent.contextTemplate ? (
						<details className="rounded-medium border border-default-200 bg-content2 px-3 py-2">
							<summary className="cursor-pointer list-none text-[11px] uppercase tracking-wider text-default-400">
								Context template
							</summary>
							<pre className="arnold-scroll mt-2 max-h-72 overflow-auto font-mono text-[11px] leading-relaxed text-default-600">
								{agent.contextTemplate}
							</pre>
							<p className="mt-2 text-[11px] text-default-500">
								Appended to the prompt body with {"{{argName}}"} placeholders filled
								from the submitted arguments. A subagent invoked directly needs
								this, because its caller normally hands it this block in prose.
							</p>
						</details>
					) : undefined}
				</div>
			</Section>
		</div>
	);
}
