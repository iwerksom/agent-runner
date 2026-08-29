/**
 * Purpose: a 14-day spend and volume sparkline for one agent, drawn as inline
 * SVG. No chart library on purpose: this is one series of at most 14 bars, and
 * the Ledger question it answers ("is this agent's spend flat or climbing?") is
 * answered by the shape alone.
 *
 * Buckets are UTC days so the same run lands in the same bar for every operator.
 */

import type { RunSummary } from "@/components/types";
import { formatCostUsd, utcDayKey } from "@/components/format";

export type CostBucket = {
	dayKey: string;
	costUsd: number;
	runCount: number;
};

/** Dense series: one bucket per day for `days` days ending today, zeros included. */
export function buildDailyCostBuckets(runs: RunSummary[], days = 14): CostBucket[] {
	const byDay = new Map<string, { costUsd: number; runCount: number }>();
	for (const run of runs) {
		const key = utcDayKey(run.createdAt);
		if (!key) continue;
		const existing = byDay.get(key) ?? { costUsd: 0, runCount: 0 };
		existing.costUsd += run.costUsd ?? 0;
		existing.runCount += 1;
		byDay.set(key, existing);
	}

	const buckets: CostBucket[] = [];
	const today = new Date();
	for (let offset = days - 1; offset >= 0; offset -= 1) {
		const day = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset),
		);
		const key = utcDayKey(day);
		const found = byDay.get(key);
		buckets.push({
			dayKey: key,
			costUsd: found?.costUsd ?? 0,
			runCount: found?.runCount ?? 0,
		});
	}
	return buckets;
}

export function CostSparkline({
	costSparklineBuckets,
	costSparklineHeight = 44,
	costSparklineLabel = "14-day cost",
}: {
	costSparklineBuckets: CostBucket[];
	costSparklineHeight?: number;
	costSparklineLabel?: string;
}) {
	const buckets = costSparklineBuckets;
	const total = buckets.reduce((sum, bucket) => sum + bucket.costUsd, 0);
	const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.costUsd), 0);

	// Fixed viewBox with a bar-per-day grid; the SVG scales to its container.
	const barSlot = 10;
	const barWidth = 6;
	const width = Math.max(buckets.length * barSlot, barSlot);
	const height = 32;
	const baseline = height - 1;

	return (
		<figure className="flex flex-col gap-1">
			<figcaption className="flex items-baseline justify-between text-xs text-default-500">
				<span>{costSparklineLabel}</span>
				<span className="font-mono tabular-nums text-default-600">
					{formatCostUsd(total)}
				</span>
			</figcaption>

			<svg
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				height={costSparklineHeight}
				className="w-full overflow-visible"
				role="img"
				aria-label={`${costSparklineLabel}: ${formatCostUsd(total)} across ${buckets.length} days`}
			>
				<line
					x1={0}
					y1={baseline}
					x2={width}
					y2={baseline}
					stroke="hsl(var(--heroui-content4))"
					strokeWidth={1}
				/>
				{buckets.map((bucket, index) => {
					// A day with runs but negligible cost still gets 2px, otherwise
					// "ran but cost nothing" and "did not run" look identical.
					const scaled = peak > 0 ? (bucket.costUsd / peak) * (height - 4) : 0;
					const barHeight =
						bucket.costUsd > 0 ? Math.max(scaled, 2) : bucket.runCount > 0 ? 1.5 : 0;
					const x = index * barSlot + (barSlot - barWidth) / 2;
					return (
						<rect
							key={bucket.dayKey || index}
							x={x}
							y={baseline - barHeight}
							width={barWidth}
							height={barHeight}
							rx={1}
							fill={
								bucket.costUsd > 0
									? "hsl(var(--heroui-primary))"
									: "hsl(var(--heroui-default-300))"
							}
						>
							<title>{`${bucket.dayKey}: ${formatCostUsd(bucket.costUsd)} · ${bucket.runCount} run(s)`}</title>
						</rect>
					);
				})}
			</svg>

			<div className="flex justify-between font-mono text-[10px] text-default-400">
				<span>{buckets[0]?.dayKey ?? ""}</span>
				<span>{buckets[buckets.length - 1]?.dayKey ?? ""}</span>
			</div>
		</figure>
	);
}
