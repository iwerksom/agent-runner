/**
 * Purpose: the "File issue" click. It is the only thing in the console that
 * writes to a repo's tracker, so it is a deliberate button on one finding and
 * never a bulk action, and it says what happened when GitHub answers.
 */

"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { useRouter } from "next/navigation";
import type { ApiErrorBody } from "@/components/types";

export function FileFindingButton({ fileFindingId }: { fileFindingId: string }) {
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	async function submit() {
		setPending(true);
		setError(undefined);
		try {
			const response = await fetch(`/api/findings/${fileFindingId}/file`, { method: "POST" });
			if (!response.ok) {
				const body = (await response.json().catch(() => undefined)) as
					ApiErrorBody | undefined;
				setError(body?.error ?? `Filing failed with HTTP ${response.status}.`);
				return;
			}
			router.refresh();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Filing request failed.");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col items-end gap-1">
			<Button
				size="sm"
				color="primary"
				variant="flat"
				isLoading={pending}
				onPress={() => void submit()}
			>
				File issue
			</Button>
			{error ? (
				<span className="max-w-xs text-right font-mono text-[11px] text-danger">
					{error}
				</span>
			) : undefined}
		</div>
	);
}
