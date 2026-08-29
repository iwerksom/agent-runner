/**
 * Purpose: resolve the user a request acts as. Phase 0 has no auth, so this is a
 * lookup of the seeded operator row and nothing more; it exists so the runs
 * route can record provenance (`Run.triggeredById`) today.
 *
 * PHASE 3 SWAP POINT: replace the body with the authenticated session's user and
 * gate the dispatch call on `minimumRoleFor(agent.writeScope)` from @arnold/core.
 */

import { prisma } from "@arnold/core";

export async function resolveActingUserId(): Promise<string | undefined> {
	const operatorRow = await prisma.user.findFirst({
		where: { role: "operator" },
		select: { id: true },
	});
	// A store seeded with a lone admin should still attribute runs to somebody.
	const userRow = operatorRow ?? (await prisma.user.findFirst({ select: { id: true } }));
	return userRow?.id ?? undefined;
}
