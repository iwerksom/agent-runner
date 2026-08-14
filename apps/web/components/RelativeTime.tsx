/**
 * Purpose: "4m ago" timestamps that keep ticking. Used for last-run times, run
 * rows and transcript frames.
 *
 * Client-side because the value depends on the reader's clock. The first paint
 * comes from the server render, which can differ by a tick from the client's
 * first render, so the <time> element suppresses hydration warnings rather than
 * hiding the value until mount — an operator scanning a run list should never
 * see a blank column.
 */

"use client";

import { useEffect, useState } from "react";
import { formatAbsolute } from "@/components/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeFromNow(iso: string, nowMs: number): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;

	const deltaMs = nowMs - then;
	const future = deltaMs < 0;
	const abs = Math.abs(deltaMs);

	const rendered = (() => {
		if (abs < 10_000) return "just now";
		if (abs < MINUTE) return `${Math.round(abs / 1000)}s`;
		if (abs < HOUR) return `${Math.floor(abs / MINUTE)}m`;
		if (abs < DAY) return `${Math.floor(abs / HOUR)}h`;
		if (abs < 30 * DAY) return `${Math.floor(abs / DAY)}d`;
		return `${Math.floor(abs / (30 * DAY))}mo`;
	})();

	if (rendered === "just now") return rendered;
	return future ? `in ${rendered}` : `${rendered} ago`;
}

export function RelativeTime({
	relativeTimeIso,
	relativeTimeClassName,
	relativeTimePrefix,
}: {
	relativeTimeIso: string | undefined;
	relativeTimeClassName?: string;
	relativeTimePrefix?: string;
}) {
	const [relativeTimeNowMs, setRelativeTimeNowMs] = useState(() => Date.now());

	useEffect(() => {
		// 30s is fine: nothing in the UI hinges on second-level freshness, and a
		// 1s interval on a 50-row table is pure churn.
		const handle = window.setInterval(() => setRelativeTimeNowMs(Date.now()), 30_000);
		return () => window.clearInterval(handle);
	}, []);

	if (!relativeTimeIso) return <span className={relativeTimeClassName}>—</span>;

	return (
		<time
			dateTime={relativeTimeIso}
			title={formatAbsolute(relativeTimeIso)}
			className={relativeTimeClassName}
			suppressHydrationWarning
		>
			{relativeTimePrefix ? `${relativeTimePrefix} ` : ""}
			{relativeFromNow(relativeTimeIso, relativeTimeNowMs)}
		</time>
	);
}
