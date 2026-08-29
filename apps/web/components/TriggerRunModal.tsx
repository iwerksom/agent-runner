/**
 * Purpose: the Dispatcher's form. Builds itself from `agent.args`, shows each
 * argument's slot as helper text so the operator can see that prNumber lands in
 * `<PR>` and windowMinutes in `{{windowMinutes}}`, and POSTs to /api/runs.
 *
 * The slot is on screen because it is the most likely silent breakage: the
 * prompt body reads a token, and a wrong mapping runs happily with the wrong
 * value substituted. Showing it makes a bad manifest visible before the spend.
 *
 * Submit gating and the POST live in useTriggerRun; this file is markup plus the
 * modal's own open state, which its parent owns.
 */

"use client";

import {
	Button,
	Chip,
	Input,
	Modal,
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	Switch,
	Textarea,
} from "@heroui/react";
import { CircleDollarSign, Info, Play, TriangleAlert, UserCheck } from "lucide-react";
import { useTriggerRun, type TriggerRunErrorKind } from "@/hooks/useTriggerRun";
import { ExecutionModeBadge, WriteScopeBadge } from "@/components/badges";
import type { AgentSummary, ArgSpec } from "@/components/types";

/** Long prose belongs in a Textarea; the issue text is the canonical case. */
function wantsTextarea(arg: ArgSpec): boolean {
	if (arg.type !== "string") return false;
	return arg.name === "issueText" || arg.name === "hotFiles" || arg.description.length > 90;
}

const ERROR_HEADINGS: Record<TriggerRunErrorKind, { title: string; explanation: string }> = {
	budget: {
		title: "Budget stop — nothing was started",
		explanation:
			"The Ledger refused the run before it began: this agent's daily cost cap, or Arnold's global cap, is already reached. Nothing was spent. Wait for the cap window to roll over or raise the cap in the manifest.",
	},
	"execution-mode": {
		title: "Execution mode refuses a headless run",
		explanation:
			"This agent is not declared safe to run unattended, so the Dispatcher will not hand it to a worker. Either run it in a local session, or supply the argument that removes the dependency.",
	},
	validation: {
		title: "Argument rejected",
		explanation: "The Dispatcher validated the arguments against the manifest and refused one.",
	},
	"missing-state": {
		title: "Required state is missing",
		explanation:
			"A state path this agent declares as required is not present in the checkout. Prime it from the artifact store, or run the agent that produces it first.",
	},
	transport: {
		title: "Could not reach the Dispatcher",
		explanation: "The request never got a response. Nothing was queued.",
	},
	unknown: {
		title: "The run was not started",
		explanation: "The Dispatcher refused the request.",
	},
};

export function TriggerRunModal({
	triggerRunModalAgent,
	triggerRunModalRepoSlug,
	triggerRunModalIsOpen,
	triggerRunModalOnClose,
}: {
	triggerRunModalAgent: AgentSummary;
	triggerRunModalRepoSlug: string;
	triggerRunModalIsOpen: boolean;
	triggerRunModalOnClose: () => void;
}) {
	const agent = triggerRunModalAgent;
	const {
		triggerRunValues,
		triggerRunSetValue,
		triggerRunMissingArgNames,
		triggerRunCanSubmit,
		triggerRunPending,
		triggerRunError,
		triggerRunErrorKind,
		triggerRunErrorDetails,
		triggerRunSubmit,
	} = useTriggerRun({
		triggerRunAgent: agent,
		triggerRunRepoSlug: triggerRunModalRepoSlug,
		triggerRunOnLaunched: triggerRunModalOnClose,
	});

	const heading = triggerRunErrorKind ? ERROR_HEADINGS[triggerRunErrorKind] : undefined;

	return (
		<Modal
			isOpen={triggerRunModalIsOpen}
			onClose={triggerRunModalOnClose}
			size="2xl"
			scrollBehavior="inside"
			backdrop="blur"
			// Restates what scrollBehavior="inside" already asks for, but with
			// utilities that exist in this app's own source rather than only inside
			// HeroUI's theme dist. Deliberate redundancy: while that dist was going
			// unscanned the wrapper lost its height utility, the panel grew to its
			// content, and "Start run" sat below the fold with nothing to scroll.
			// This is the operator's primary action; it should not hinge on one
			// generated utility.
			classNames={{
				wrapper: "h-dvh items-center",
				base: "my-0 max-h-[85dvh]",
				body: "overflow-y-auto",
			}}
		>
			<ModalContent>
				<ModalHeader className="flex flex-col gap-1">
					<span className="text-base font-semibold">Run {agent.name}</span>
					<div className="flex flex-wrap items-center gap-2">
						<Chip
							size="sm"
							variant="flat"
							classNames={{ content: "font-mono text-xs" }}
						>
							{agent.id}
						</Chip>
						<Chip
							size="sm"
							variant="flat"
							classNames={{ content: "font-mono text-xs" }}
						>
							{triggerRunModalRepoSlug}
						</Chip>
						<WriteScopeBadge writeScope={agent.writeScope} />
						<ExecutionModeBadge executionMode={agent.execution} />
					</div>
				</ModalHeader>

				<ModalBody className="gap-4">
					<p className="text-sm text-default-500">{agent.description}</p>

					{agent.ingestsUntrustedInput ? (
						<div className="flex gap-2 rounded-medium border border-default-200 bg-content2 p-3 text-xs text-default-600">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-default-500" />
							<span>
								This agent reads text from outside the repo. Whatever you paste is
								handled as data, never as instruction.
							</span>
						</div>
					) : undefined}

					{agent.args.length === 0 ? (
						<p className="text-sm text-default-500">
							This agent takes no arguments. Submitting starts it immediately.
						</p>
					) : undefined}

					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (triggerRunCanSubmit) void triggerRunSubmit();
						}}
					>
						{agent.args.map((arg) => {
							const value = triggerRunValues[arg.name] ?? "";
							const missing = triggerRunMissingArgNames.includes(arg.name);
							const helper = (
								<span className="flex flex-wrap items-center gap-1.5">
									<span className="text-default-500">{arg.description}</span>
									<span className="text-default-400">lands in</span>
									<code className="rounded bg-content3 px-1 py-0.5 font-mono text-[11px] text-default-700">
										{arg.slot}
									</code>
								</span>
							);

							if (arg.type === "boolean") {
								return (
									<div key={arg.name} className="flex flex-col gap-1">
										<Switch
											isSelected={value === "true"}
											onValueChange={(selected) =>
												triggerRunSetValue(
													arg.name,
													selected ? "true" : "false",
												)
											}
											size="sm"
										>
											<span className="text-sm">{arg.name}</span>
										</Switch>
										<div className="text-xs">{helper}</div>
									</div>
								);
							}

							if (wantsTextarea(arg)) {
								return (
									<Textarea
										key={arg.name}
										label={arg.name}
										labelPlacement="outside"
										value={value}
										onValueChange={(next) => triggerRunSetValue(arg.name, next)}
										isRequired={arg.required === true}
										isInvalid={missing}
										minRows={6}
										maxRows={18}
										description={helper}
										placeholder={arg.default ?? ""}
										classNames={{ input: "text-sm" }}
									/>
								);
							}

							return (
								<Input
									key={arg.name}
									label={arg.name}
									labelPlacement="outside"
									type={arg.type === "number" ? "number" : "text"}
									value={value}
									onValueChange={(next) => triggerRunSetValue(arg.name, next)}
									isRequired={arg.required === true}
									isInvalid={missing}
									description={helper}
									placeholder={arg.default ?? ""}
								/>
							);
						})}
					</form>

					{agent.budget ? (
						<div className="flex flex-wrap items-center gap-3 rounded-medium bg-content2 px-3 py-2 text-xs text-default-500">
							<CircleDollarSign className="h-4 w-4 text-default-400" />
							<span>
								Capped at{" "}
								<span className="font-mono text-default-700">
									${agent.budget.dailyCostCapUsd.toFixed(2)}/day
								</span>
								, {agent.budget.maxTurns} turns, {agent.budget.maxWallClockMinutes}{" "}
								minutes wall clock.
							</span>
						</div>
					) : undefined}

					{agent.execution !== "unattended" ? (
						<div className="flex gap-2 rounded-medium border border-warning-400 bg-warning-50/10 p-3 text-xs text-warning-600">
							<UserCheck className="mt-0.5 h-4 w-4 shrink-0" />
							<span>
								Declared <span className="font-mono">{agent.execution}</span>. The
								Dispatcher may refuse this with a 409 unless an argument relaxes it
								{agent.unattendedIfArgs && agent.unattendedIfArgs.length > 0 ? (
									<>
										{" "}
										(
										<span className="font-mono">
											{agent.unattendedIfArgs.join(", ")}
										</span>
										)
									</>
								) : undefined}
								.
							</span>
						</div>
					) : undefined}

					{triggerRunError && heading ? (
						<div
							className={`flex flex-col gap-2 rounded-medium border p-3 text-xs ${
								triggerRunErrorKind === "budget"
									? "border-warning-400 bg-warning-50/10 text-warning-600"
									: "border-danger-400 bg-danger-50/10 text-danger-500"
							}`}
						>
							<div className="flex items-center gap-2 text-sm font-semibold">
								<TriangleAlert className="h-4 w-4" />
								{heading.title}
							</div>
							{/* The route's message is shown verbatim: it is the only place the
							    real reason (which cap, which argument) is stated. */}
							<p className="font-mono text-[11px] leading-relaxed text-foreground">
								{triggerRunError}
							</p>
							<p className="text-default-500">{heading.explanation}</p>
							{triggerRunErrorDetails ? (
								<pre className="max-h-40 overflow-auto rounded bg-content2 p-2 font-mono text-[11px] text-default-600">
									{triggerRunErrorDetails}
								</pre>
							) : undefined}
						</div>
					) : undefined}
				</ModalBody>

				<ModalFooter className="items-center justify-between">
					<span className="text-xs text-default-400">
						{triggerRunMissingArgNames.length > 0
							? `Required: ${triggerRunMissingArgNames.join(", ")}`
							: "All required arguments filled."}
					</span>
					<div className="flex gap-2">
						<Button variant="light" onPress={triggerRunModalOnClose} size="sm">
							Cancel
						</Button>
						<Button
							color="primary"
							size="sm"
							isDisabled={!triggerRunCanSubmit}
							isLoading={triggerRunPending}
							startContent={
								triggerRunPending ? undefined : <Play className="h-4 w-4" />
							}
							onPress={() => void triggerRunSubmit()}
						>
							Start run
						</Button>
					</div>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
}
