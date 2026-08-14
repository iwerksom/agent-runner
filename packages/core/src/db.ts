/**
 * Purpose: the single PrismaClient for the process, cached on `globalThis`.
 *
 * Next's dev server re-evaluates modules on every hot reload. A module-scoped
 * `new PrismaClient()` would therefore open a new SQLite connection pool per
 * edit until the file handles run out, so the instance is parked on a global and
 * reused. Phase 1 keeps this file and only changes the datasource.
 */

import { PrismaClient } from "@prisma/client";

/** Distinct key so nothing else on the global object can collide with ours. */
const ARNOLD_PRISMA_KEY = "__arnoldPrismaClient__";

type PrismaGlobal = typeof globalThis & { [ARNOLD_PRISMA_KEY]?: PrismaClient };

const prismaGlobal = globalThis as PrismaGlobal;

function createPrismaClient(): PrismaClient {
	return new PrismaClient({
		// Warnings and errors only: a run's transcript is already persisted as
		// RunEvent rows, and query logging would bury it.
		log: ["warn", "error"],
	});
}

export const prisma: PrismaClient = prismaGlobal[ARNOLD_PRISMA_KEY] ?? createPrismaClient();

// Only cache outside production. A production build evaluates the module once,
// and holding the client on a global there would keep it alive across a
// serverless invocation boundary where the socket is already gone.
if (process.env.NODE_ENV !== "production") {
	prismaGlobal[ARNOLD_PRISMA_KEY] = prisma;
}

/** Used by scripts, which must not leave the process hanging on an open pool. */
export async function disconnectPrisma(): Promise<void> {
	await prisma.$disconnect();
}
