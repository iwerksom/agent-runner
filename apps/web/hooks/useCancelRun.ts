/**
 * Purpose: POST /api/runs/[runId]/cancel and reflect the result. Cancellation is
 * the only write the run screen performs, and it is not idempotent from the
 * operator's point of view (a run that finished a second ago cannot be
 * cancelled), so the route's error message is shown verbatim.
 */

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorBody } from "@/components/types";

export function useCancelRun(cancelRunRunId: string): {
	cancelRunPending: boolean;
	cancelRunError: string | undefined;
	cancelRunSucceeded: boolean;
	cancelRunSubmit: () => Promise<void>;
} {
	const router = useRouter();
	const [cancelRunPending, setCancelRunPending] = useState(false);
	const [cancelRunError, setCancelRunError] = useState<string | undefined>(undefined);
	const [cancelRunSucceeded, setCancelRunSucceeded] = useState(false);

	const cancelRunSubmit = useCallback(async () => {
		setCancelRunPending(true);
		setCancelRunError(undefined);
		try {
			const response = await fetch(`/api/runs/${encodeURIComponent(cancelRunRunId)}/cancel`, {
				method: "POST",
				headers: { "content-type": "application/json" },
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => undefined)) as
					ApiErrorBody | undefined;
				setCancelRunError(body?.error ?? `Cancel failed with HTTP ${response.status}.`);
				return;
			}
			setCancelRunSucceeded(true);
			// The SSE stream reports the status change, but the header's duration and
			// exit reason come from the server payload, so refresh it too.
			router.refresh();
		} catch (error) {
			setCancelRunError(error instanceof Error ? error.message : "Cancel request failed.");
		} finally {
			setCancelRunPending(false);
		}
	}, [cancelRunRunId, router]);

	return { cancelRunPending, cancelRunError, cancelRunSucceeded, cancelRunSubmit };
}
