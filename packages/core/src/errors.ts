/**
 * Purpose: Arnold's error taxonomy. Every failure an operator can cause or fix
 * has its own class with a stable `code`, so the web tier can branch on the code
 * instead of matching on message text, and a run's `exitReason` stays greppable
 * across releases.
 *
 * Messages are written for the operator, not the developer: they say what is
 * missing and what to do about it.
 */

/** Base for everything Arnold throws on purpose. */
export class ArnoldError extends Error {
	/** Stable, machine-readable discriminator. Never change an existing value. */
	readonly code: string;
	/** Optional structured context for the UI (arg names, globs, paths). */
	readonly details?: Record<string, unknown>;

	constructor(code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.code = code;
		this.name = new.target.name;
		if (details !== undefined) this.details = details;
	}
}

/** Submitted arguments do not satisfy the manifest's `args`. */
export class ValidationError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("VALIDATION", message, details);
	}
}

/** A daily spend cap would be exceeded, so the run never starts. */
export class BudgetError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("BUDGET", message, details);
	}
}

/** The agent cannot run headless with the arguments given. */
export class ExecutionModeError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("EXECUTION_MODE", message, details);
	}
}

/** A required `statePaths` entry is absent from the leased checkout. */
export class StateMissingError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("STATE_MISSING", message, details);
	}
}

/** git failed, or a path escaped the leased worktree. */
export class WorkspaceError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("WORKSPACE", message, details);
	}
}

/** A row the caller named does not exist. */
export class NotFoundError extends ArnoldError {
	constructor(message: string, details?: Record<string, unknown>) {
		super("NOT_FOUND", message, details);
	}
}

/** Narrowing helper, so call sites never reach for `instanceof Error` casts. */
export function isArnoldError(value: unknown): value is ArnoldError {
	return value instanceof ArnoldError;
}

/** Best-effort message for anything thrown, including non-Error rejections. */
export function errorMessageOf(value: unknown): string {
	if (value instanceof Error) return value.message;
	if (typeof value === "string") return value;
	return String(value);
}
