/**
 * Purpose: the Dispatcher form's orchestration — argument state seeded from the
 * manifest defaults, required-argument gating, the POST to /api/runs, and the
 * routing to the new run on 201. Kept out of the modal component so the modal is
 * only markup and UI-local open state.
 *
 * Values are held and submitted as strings, because that is what inputs produce
 * and what the route accepts (`args: z.record(z.string())`). Typing is not the web
 * tier's job: the Dispatcher validates each value against its ArgSpec, so
 * coercing here would only move a 400 from the place that can explain it to the
 * place that cannot.
 *
 * The four contract failures are told apart by status code and worded
 * differently, because the operator's next action differs: 400 fix an argument,
 * 409 run it locally, 422 prime the missing state, 429 wait or raise the cap.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentSummary, ApiErrorBody, ArgSpec } from "@/components/types";

export type TriggerRunErrorKind =
	"validation" | "execution-mode" | "budget" | "missing-state" | "transport" | "unknown";

function seedValues(args: ArgSpec[]): Record<string, string> {
	const seeded: Record<string, string> = {};
	for (const arg of args) {
		seeded[arg.name] = arg.default ?? (arg.type === "boolean" ? "false" : "");
	}
	return seeded;
}

/**
 * Empty means "not supplied", so the Dispatcher applies the manifest default
 * rather than substituting a blank into the slot. Long text keeps its whitespace;
 * only scalars are trimmed, since a stray newline in a Jira issue body is content.
 */
function submittedValue(arg: ArgSpec, raw: string): string | undefined {
	if (raw.trim() === "") return undefined;
	return arg.type === "string" ? raw : raw.trim();
}

function errorKindFor(status: number): TriggerRunErrorKind {
	if (status === 400) return "validation";
	if (status === 409) return "execution-mode";
	if (status === 422) return "missing-state";
	if (status === 429) return "budget";
	return "unknown";
}

export function useTriggerRun({
	triggerRunAgent,
	triggerRunRepoSlug,
	triggerRunOnLaunched,
}: {
	triggerRunAgent: AgentSummary;
	triggerRunRepoSlug: string;
	/** Called after a successful POST, before navigation, so the modal can close. */
	triggerRunOnLaunched?: (runId: string) => void;
}): {
	triggerRunValues: Record<string, string>;
	triggerRunSetValue: (argName: string, value: string) => void;
	/** Branch, tag or SHA. Empty means the repo's default branch. */
	triggerRunBaseRef: string;
	triggerRunSetBaseRef: (baseRef: string) => void;
	triggerRunMissingArgNames: string[];
	triggerRunCanSubmit: boolean;
	triggerRunPending: boolean;
	triggerRunError: string | undefined;
	triggerRunErrorKind: TriggerRunErrorKind | undefined;
	triggerRunErrorDetails: string | undefined;
	triggerRunSubmit: () => Promise<void>;
	triggerRunReset: () => void;
} {
	const router = useRouter();
	const [triggerRunValues, setTriggerRunValues] = useState<Record<string, string>>(() =>
		seedValues(triggerRunAgent.args),
	);
	const [triggerRunBaseRef, setTriggerRunBaseRef] = useState("");
	const [triggerRunPending, setTriggerRunPending] = useState(false);
	const [triggerRunError, setTriggerRunError] = useState<string | undefined>(undefined);
	const [triggerRunErrorKind, setTriggerRunErrorKind] = useState<TriggerRunErrorKind | undefined>(
		undefined,
	);
	const [triggerRunErrorDetails, setTriggerRunErrorDetails] = useState<string | undefined>(
		undefined,
	);

	const triggerRunSetValue = useCallback((argName: string, value: string) => {
		setTriggerRunValues((previous) => ({ ...previous, [argName]: value }));
	}, []);

	const triggerRunReset = useCallback(() => {
		setTriggerRunValues(seedValues(triggerRunAgent.args));
		setTriggerRunBaseRef("");
		setTriggerRunError(undefined);
		setTriggerRunErrorKind(undefined);
		setTriggerRunErrorDetails(undefined);
	}, [triggerRunAgent.args]);

	const triggerRunMissingArgNames = useMemo(
		() =>
			triggerRunAgent.args
				.filter((arg) => arg.required && (triggerRunValues[arg.name] ?? "").trim() === "")
				.map((arg) => arg.name),
		[triggerRunAgent.args, triggerRunValues],
	);

	const triggerRunCanSubmit =
		triggerRunAgent.runnable && triggerRunMissingArgNames.length === 0 && !triggerRunPending;

	const triggerRunSubmit = useCallback(async () => {
		setTriggerRunPending(true);
		setTriggerRunError(undefined);
		setTriggerRunErrorKind(undefined);
		setTriggerRunErrorDetails(undefined);

		const args: Record<string, string> = {};
		for (const arg of triggerRunAgent.args) {
			const value = submittedValue(arg, triggerRunValues[arg.name] ?? "");
			if (value !== undefined) args[arg.name] = value;
		}

		try {
			const response = await fetch("/api/runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					agentId: triggerRunAgent.id,
					repoSlug: triggerRunRepoSlug,
					args,
					// Omitted rather than sent empty, so the Dispatcher applies the
					// repo's default branch instead of validating a blank ref.
					...(triggerRunBaseRef.trim() === ""
						? {}
						: { baseRef: triggerRunBaseRef.trim() }),
				}),
			});

			const body = (await response.json().catch(() => undefined)) as
				{ runId?: string } | ApiErrorBody | undefined;

			if (!response.ok) {
				const errorBody = body as ApiErrorBody | undefined;
				setTriggerRunErrorKind(errorKindFor(response.status));
				setTriggerRunError(
					errorBody?.error ?? `Request failed with HTTP ${response.status}.`,
				);
				if (errorBody?.details !== undefined) {
					setTriggerRunErrorDetails(
						typeof errorBody.details === "string"
							? errorBody.details
							: JSON.stringify(errorBody.details, undefined, 2),
					);
				}
				return;
			}

			const runId = (body as { runId?: string } | undefined)?.runId;
			if (!runId) {
				setTriggerRunErrorKind("unknown");
				setTriggerRunError("The run was accepted but no runId came back.");
				return;
			}

			triggerRunOnLaunched?.(runId);
			router.push(`/runs/${runId}`);
		} catch (error) {
			setTriggerRunErrorKind("transport");
			setTriggerRunError(
				error instanceof Error ? error.message : "Could not reach the Dispatcher.",
			);
		} finally {
			setTriggerRunPending(false);
		}
	}, [
		router,
		triggerRunAgent.args,
		triggerRunAgent.id,
		triggerRunBaseRef,
		triggerRunOnLaunched,
		triggerRunRepoSlug,
		triggerRunValues,
	]);

	return {
		triggerRunValues,
		triggerRunSetValue,
		triggerRunBaseRef,
		triggerRunSetBaseRef: setTriggerRunBaseRef,
		triggerRunMissingArgNames,
		triggerRunCanSubmit,
		triggerRunPending,
		triggerRunError,
		triggerRunErrorKind,
		triggerRunErrorDetails,
		triggerRunSubmit,
		triggerRunReset,
	};
}
