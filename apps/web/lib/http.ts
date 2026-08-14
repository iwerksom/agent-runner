/**
 * Purpose: the single JSON response shape for Arnold's API, plus the one place
 * that decides which HTTP status an @arnold/core error deserves.
 *
 * Routes never build an error body themselves: they let core throw and hand the
 * exception to `errorResponse`, so a new ArnoldError subclass gets a sensible
 * status in one edit instead of nine.
 */

import { NextResponse } from "next/server";
import {
	BudgetError,
	ExecutionModeError,
	NotFoundError,
	StateMissingError,
	ValidationError,
	WorkspaceError,
} from "@arnold/core";

export type ApiErrorBody = {
	error: string;
	code?: string;
	details?: unknown;
};

/**
 * Fallback lookup by constructor name. `instanceof` fails when two copies of
 * @arnold/core end up loaded (dev HMR plus `transpilePackages`), and a 500 on a
 * validation error would be misleading.
 */
const STATUS_BY_ERROR_NAME: Record<string, number> = {
	ValidationError: 400,
	ExecutionModeError: 409,
	BudgetError: 429,
	NotFoundError: 404,
	StateMissingError: 422,
	WorkspaceError: 500,
};

export function ok<T>(payload: T, init?: ResponseInit): NextResponse<T> {
	return NextResponse.json(payload, init);
}

export function fail(
	error: string,
	status: number,
	details?: unknown,
	code?: string,
): NextResponse<ApiErrorBody> {
	const body: ApiErrorBody = { error };
	if (code !== undefined) body.code = code;
	if (details !== undefined) body.details = details;
	return NextResponse.json(body, { status });
}

function statusForError(err: unknown): number {
	if (err instanceof ValidationError) return 400;
	if (err instanceof ExecutionModeError) return 409;
	if (err instanceof BudgetError) return 429;
	if (err instanceof NotFoundError) return 404;
	if (err instanceof StateMissingError) return 422;
	if (err instanceof WorkspaceError) return 500;
	const errorName = err instanceof Error ? err.name || err.constructor.name : "";
	return STATUS_BY_ERROR_NAME[errorName] ?? 500;
}

export function errorResponse(err: unknown): NextResponse<ApiErrorBody> {
	const status = statusForError(err);
	const message = err instanceof Error ? err.message : "Unexpected error";
	const candidate = err as { code?: unknown; details?: unknown } | null;
	const code = typeof candidate?.code === "string" ? candidate.code : undefined;

	// A 5xx is either a bug or an unmapped error class; either way the stack is
	// the only thing that will explain it after the fact.
	if (status >= 500) console.error("[arnold:api]", err);

	return fail(message, status, candidate?.details, code);
}
