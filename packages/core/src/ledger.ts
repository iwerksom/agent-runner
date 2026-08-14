/**
 * Purpose: per-day, per-scope spend caps, checked before a run starts and
 * incremented after it ends.
 *
 * Two scopes are enforced: "global" against ARNOLD_DAILY_COST_CAP_USD, and
 * "agent:<id>" against that agent's own `budget.dailyCostCapUsd`. Both exist so
 * one looping agent cannot eat the day's budget and stall everything else. A
 * "repo:<slug>" row is written for reporting but has no cap yet.
 *
 * The day key is UTC. A local-time key would move the reset point twice a year
 * and make a cap look breached to whoever is reading the chart in another zone.
 */

import type { Ledger } from "@prisma/client";
import { prisma } from "./db.js";

export type BudgetCheck = { ok: true } | { ok: false; reason: string };

export type UsageDelta = {
	cost: number;
	tokens: number;
};

/** YYYY-MM-DD in UTC. */
export function ledgerDayKey(when: Date = new Date()): string {
	return when.toISOString().slice(0, 10);
}

export function globalDailyCapUsd(): number {
	const configured = Number(process.env.ARNOLD_DAILY_COST_CAP_USD);
	return Number.isFinite(configured) && configured > 0 ? configured : 10;
}

/** The cap that applies to a scope, or undefined when the scope is uncapped. */
function capForScope(scope: string, budget: { dailyCostCapUsd: number }): number | undefined {
	if (scope === "global") return globalDailyCapUsd();
	if (scope.startsWith("agent:")) return budget.dailyCostCapUsd;
	return undefined;
}

async function spentTodayFor(scope: string, day: string): Promise<number> {
	const row = await prisma.ledger.findUnique({ where: { scope_day: { scope, day } } });
	return row?.costUsd ?? 0;
}

/**
 * Pre-flight. Returns a reason rather than throwing so the Dispatcher can decide
 * whether a refusal is a BudgetError (a queued run) or a status change (a run
 * already in flight).
 */
export async function checkBudget(
	scopes: string[],
	budget: { dailyCostCapUsd: number },
): Promise<BudgetCheck> {
	const day = ledgerDayKey();
	for (const scope of scopes) {
		const cap = capForScope(scope, budget);
		if (cap === undefined) continue;
		const spent = await spentTodayFor(scope, day);
		if (spent >= cap) {
			return {
				ok: false,
				reason: `daily cap reached for scope "${scope}": $${spent.toFixed(4)} of $${cap.toFixed(2)} spent on ${day}`,
			};
		}
	}
	return { ok: true };
}

/** Increment every scope by one run's usage. Called once, after the run ends. */
export async function recordUsage(scopes: string[], usage: UsageDelta): Promise<void> {
	const day = ledgerDayKey();
	const cost = Number.isFinite(usage.cost) ? usage.cost : 0;
	const tokens = Number.isFinite(usage.tokens) ? Math.round(usage.tokens) : 0;
	for (const scope of scopes) {
		await prisma.ledger.upsert({
			where: { scope_day: { scope, day } },
			create: { scope, day, costUsd: cost, tokens, runCount: 1 },
			update: {
				costUsd: { increment: cost },
				tokens: { increment: tokens },
				runCount: { increment: 1 },
			},
		});
	}
}

/** Rows for the last `days` days, newest day first. For the spend chart. */
export async function getLedger(days: number): Promise<Ledger[]> {
	const span = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
	const earliest = new Date(Date.now() - (span - 1) * 24 * 60 * 60 * 1000);
	return prisma.ledger.findMany({
		where: { day: { gte: ledgerDayKey(earliest) } },
		orderBy: [{ day: "desc" }, { scope: "asc" }],
	});
}
