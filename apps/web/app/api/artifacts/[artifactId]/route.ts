/**
 * Purpose: GET /api/artifacts/[artifactId]. Streams a collected artifact's bytes
 * back with the mime type recorded at collection time.
 *
 * Disposition is `inline` on purpose: almost every artifact is a markdown report
 * or a JSONL metrics file the operator wants to read in the browser, not
 * download. The stored `path` is what the agent wrote, so only its basename is
 * offered as the filename.
 */

import { basename } from "node:path";
import { prisma, readArtifact } from "@arnold/core";
import { errorResponse, fail } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `readArtifact` reads from a local path in Phase 0 and an object store later, so
 * the return type is normalised here rather than assumed.
 */
function toBodyBytes(raw: unknown): Uint8Array {
	if (typeof raw === "string") return new TextEncoder().encode(raw);
	if (raw instanceof Uint8Array) return raw;
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	throw new Error("readArtifact returned a body that is neither text nor bytes");
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ artifactId: string }> },
) {
	const { artifactId } = await params;

	try {
		const artifactRow = await prisma.artifact.findUnique({
			where: { id: artifactId },
			select: { path: true, storageKey: true, mimeType: true },
		});
		if (!artifactRow) {
			return fail(`No artifact with id ${artifactId}`, 404, undefined, "artifact_not_found");
		}

		const bytes = toBodyBytes(await readArtifact(artifactRow.storageKey));
		// A quote in the filename would terminate the header value early.
		const filename = basename(artifactRow.path).replace(/"/g, "");

		return new Response(bytes as unknown as BodyInit, {
			headers: {
				"Content-Type": artifactRow.mimeType,
				"Content-Length": String(bytes.byteLength),
				"Content-Disposition": `inline; filename="${filename}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (err) {
		return errorResponse(err);
	}
}
