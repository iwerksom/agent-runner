/**
 * Purpose: GET /api/ledger. Spend and run volume per day and per scope, for the
 * dashboard's cost strip. The window is a query parameter because the same
 * endpoint feeds a 7-day sparkline and a 30-day review.
 *
 * The shape is core's: the ledger is aggregated in @arnold/core so the budget
 * check and the chart cannot disagree about what a day's spend was.
 */

import { getLedger } from "@arnold/core";
import { errorResponse, fail, ok } from "@/lib/http";
import { ledgerQuerySchema, searchParamsRecord } from "@/lib/params";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const parsedQuery = ledgerQuerySchema.safeParse(searchParamsRecord(request.url));
	if (!parsedQuery.success) {
		return fail("Invalid ledger query", 400, parsedQuery.error.flatten(), "invalid_query");
	}

	try {
		const ledger = await getLedger(parsedQuery.data.days);
		return ok({ ledger });
	} catch (err) {
		return errorResponse(err);
	}
}
