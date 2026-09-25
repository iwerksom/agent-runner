/**
 * Purpose: the write side of the repos page — create, edit, probe, archive,
 * restore and delete — behind one hook so every caller reports failure the same
 * way.
 *
 * Errors are surfaced verbatim from `ApiErrorBody.error`, because core writes
 * those messages for the operator and they say what to do: which path does not
 * exist, how many runs block a delete, why a slug was refused. Replacing them
 * with a generic string here would throw away the only useful part.
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorBody, CheckoutProbe, RepoRemovalPlan } from "@/components/types";

export type RepoFormValues = {
	slug: string;
	name: string;
	remoteUrl: string;
	localPath: string;
	defaultBranch: string;
	claudeDir: string;
	/** Every field in the form, keyed by variable name; "" means not set. */
	promptVariables: Record<string, string>;
};

/** Reads the error message out of whatever the route returned. */
async function errorMessageFrom(response: Response, fallback: string): Promise<string> {
	const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
	return body?.error ?? `${fallback} (HTTP ${response.status}).`;
}

export function useRepoAdmin(): {
	repoAdminPending: boolean;
	repoAdminError: string | undefined;
	repoAdminClearError: () => void;
	repoAdminProbe: (localPath: string, claudeDir: string) => Promise<CheckoutProbe | undefined>;
	repoAdminCreate: (values: RepoFormValues) => Promise<boolean>;
	repoAdminUpdate: (slug: string, values: Omit<RepoFormValues, "slug">) => Promise<boolean>;
	repoAdminPlanRemoval: (slug: string) => Promise<RepoRemovalPlan | undefined>;
	repoAdminRemove: (slug: string, mode: "archive" | "delete") => Promise<boolean>;
	repoAdminRestore: (slug: string) => Promise<boolean>;
} {
	const router = useRouter();
	const [repoAdminPending, setRepoAdminPending] = useState(false);
	const [repoAdminError, setRepoAdminError] = useState<string | undefined>(undefined);

	const repoAdminClearError = useCallback(() => setRepoAdminError(undefined), []);

	/**
	 * One request shape for every mutation: run it, translate a non-2xx into a
	 * message, and refresh the server-rendered list on success.
	 */
	const mutate = useCallback(
		async (input: RequestInfo, init: RequestInit, fallback: string): Promise<boolean> => {
			setRepoAdminPending(true);
			setRepoAdminError(undefined);
			try {
				const response = await fetch(input, init);
				if (!response.ok) {
					setRepoAdminError(await errorMessageFrom(response, fallback));
					return false;
				}
				router.refresh();
				return true;
			} catch (error) {
				setRepoAdminError(error instanceof Error ? error.message : fallback);
				return false;
			} finally {
				setRepoAdminPending(false);
			}
		},
		[router],
	);

	const jsonPost = (body: unknown): RequestInit => ({
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	const repoAdminProbe = useCallback(async (localPath: string, claudeDir: string) => {
		setRepoAdminError(undefined);
		try {
			const response = await fetch("/api/repo-probe", jsonPost({ localPath, claudeDir }));
			if (!response.ok) {
				setRepoAdminError(await errorMessageFrom(response, "Could not read that path"));
				return undefined;
			}
			const body = (await response.json()) as { probe: CheckoutProbe };
			return body.probe;
		} catch (error) {
			setRepoAdminError(error instanceof Error ? error.message : "Could not read that path.");
			return undefined;
		}
	}, []);

	const repoAdminCreate = useCallback(
		(values: RepoFormValues) =>
			mutate("/api/repos", jsonPost(values), "Could not add the repo"),
		[mutate],
	);

	const repoAdminUpdate = useCallback(
		(slug: string, values: Omit<RepoFormValues, "slug">) =>
			mutate(
				`/api/repos/${encodeURIComponent(slug)}`,
				{
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(values),
				},
				"Could not save the repo",
			),
		[mutate],
	);

	/**
	 * Read before write: the confirmation dialog states the consequence (how many
	 * runs, how many worktrees) instead of asking the operator to guess.
	 */
	const repoAdminPlanRemoval = useCallback(async (slug: string) => {
		setRepoAdminError(undefined);
		try {
			const response = await fetch(`/api/repos/${encodeURIComponent(slug)}`);
			if (!response.ok) {
				setRepoAdminError(await errorMessageFrom(response, "Could not read the repo"));
				return undefined;
			}
			const body = (await response.json()) as { removal: RepoRemovalPlan };
			return body.removal;
		} catch (error) {
			setRepoAdminError(error instanceof Error ? error.message : "Could not read the repo.");
			return undefined;
		}
	}, []);

	const repoAdminRemove = useCallback(
		(slug: string, mode: "archive" | "delete") =>
			mutate(
				`/api/repos/${encodeURIComponent(slug)}?mode=${mode}`,
				{ method: "DELETE" },
				mode === "archive" ? "Could not archive the repo" : "Could not delete the repo",
			),
		[mutate],
	);

	const repoAdminRestore = useCallback(
		(slug: string) =>
			mutate(
				`/api/repos/${encodeURIComponent(slug)}/unarchive`,
				{ method: "POST" },
				"Could not restore the repo",
			),
		[mutate],
	);

	return {
		repoAdminPending,
		repoAdminError,
		repoAdminClearError,
		repoAdminProbe,
		repoAdminCreate,
		repoAdminUpdate,
		repoAdminPlanRemoval,
		repoAdminRemove,
		repoAdminRestore,
	};
}
