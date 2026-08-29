/**
 * Purpose: fetch an artifact's bytes as text, once, when its panel is first
 * opened. /api/artifacts/[id] streams raw bytes, so this is only used for
 * artifacts the UI can render inline (markdown, text, JSON) and never for the
 * whole list — a run can collect a report per PR and eagerly fetching them all
 * would download the artifact store on page load.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_INLINE_BYTES = 512 * 1024;

export function useArtifactText({
	artifactTextArtifactId,
	artifactTextEnabled,
}: {
	artifactTextArtifactId: string;
	/** Set true when the panel opens; the fetch runs at most once per artifact. */
	artifactTextEnabled: boolean;
}): {
	artifactTextContent: string | undefined;
	artifactTextLoading: boolean;
	artifactTextError: string | undefined;
	artifactTextReload: () => void;
} {
	const [artifactTextContent, setArtifactTextContent] = useState<string | undefined>(undefined);
	const [artifactTextLoading, setArtifactTextLoading] = useState(false);
	const [artifactTextError, setArtifactTextError] = useState<string | undefined>(undefined);
	const fetchedRef = useRef(false);
	const [reloadToken, setReloadToken] = useState(0);

	const artifactTextReload = useCallback(() => {
		fetchedRef.current = false;
		setReloadToken((previous) => previous + 1);
	}, []);

	useEffect(() => {
		if (!artifactTextEnabled || fetchedRef.current) return;
		fetchedRef.current = true;

		const controller = new AbortController();
		setArtifactTextLoading(true);
		setArtifactTextError(undefined);

		void (async () => {
			try {
				const response = await fetch(
					`/api/artifacts/${encodeURIComponent(artifactTextArtifactId)}`,
					{ signal: controller.signal },
				);
				if (!response.ok) {
					setArtifactTextError(`Could not load artifact (HTTP ${response.status}).`);
					return;
				}
				const text = await response.text();
				setArtifactTextContent(
					text.length > MAX_INLINE_BYTES
						? `${text.slice(0, MAX_INLINE_BYTES)}\n\n…truncated for display. Open the raw artifact for the rest.`
						: text,
				);
			} catch (error) {
				if (controller.signal.aborted) return;
				setArtifactTextError(
					error instanceof Error ? error.message : "Could not load artifact.",
				);
			} finally {
				if (!controller.signal.aborted) setArtifactTextLoading(false);
			}
		})();

		return () => controller.abort();
	}, [artifactTextArtifactId, artifactTextEnabled, reloadToken]);

	return { artifactTextContent, artifactTextLoading, artifactTextError, artifactTextReload };
}
