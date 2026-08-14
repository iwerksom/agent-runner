/**
 * Purpose: a standalone Run control for the agent detail page, pinned to one
 * repo. The agent card has its own; this is the same trigger without the card
 * around it.
 *
 * Client component so it can own the modal's open state, which is UI-local.
 * A non-runnable agent keeps the button visible but disabled, with the reason in
 * a tooltip: hiding it would leave an operator wondering where it went.
 */

"use client";

import { Button, Tooltip } from "@heroui/react";
import { Play } from "lucide-react";
import { useState } from "react";
import { TriggerRunModal } from "@/components/TriggerRunModal";
import type { AgentSummary } from "@/components/types";

export function AgentRunButton({
	agentRunButtonAgent,
	agentRunButtonRepoSlug,
	agentRunButtonLabel,
}: {
	agentRunButtonAgent: AgentSummary;
	agentRunButtonRepoSlug: string;
	agentRunButtonLabel?: string;
}) {
	const [agentRunButtonModalOpen, setAgentRunButtonModalOpen] = useState(false);
	const agent = agentRunButtonAgent;
	const disabled = !agent.runnable || agent.state === "unregistered";
	const reason =
		agent.notRunnableReason ??
		(agent.state === "unregistered"
			? "Needs a tool policy and write scope before it can run."
			: "Not runnable.");

	if (disabled) {
		return (
			<Tooltip content={reason} delay={150} className="max-w-xs">
				<span className="inline-flex" tabIndex={0}>
					<Button
						size="sm"
						color="primary"
						variant="flat"
						isDisabled
						startContent={<Play className="h-4 w-4" />}
					>
						{agentRunButtonLabel ?? "Run"}
					</Button>
				</span>
			</Tooltip>
		);
	}

	return (
		<>
			<Button
				size="sm"
				color="primary"
				startContent={<Play className="h-4 w-4" />}
				onPress={() => setAgentRunButtonModalOpen(true)}
			>
				{agentRunButtonLabel ?? "Run"}
			</Button>
			{agentRunButtonModalOpen ? (
				<TriggerRunModal
					triggerRunModalAgent={agent}
					triggerRunModalRepoSlug={agentRunButtonRepoSlug}
					triggerRunModalIsOpen={agentRunButtonModalOpen}
					triggerRunModalOnClose={() => setAgentRunButtonModalOpen(false)}
				/>
			) : undefined}
		</>
	);
}
