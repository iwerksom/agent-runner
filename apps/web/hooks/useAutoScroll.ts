/**
 * Purpose: keep a live transcript pinned to its newest frame, and stop the
 * moment the reader scrolls up. Reading back through a running agent's tool
 * calls is the main thing operators do on the run screen, so a scroll container
 * that yanks itself back down is worse than no auto-scroll at all.
 *
 * Re-pins when the reader returns to the bottom, within a small threshold so a
 * one-pixel rounding error does not count as "scrolled away".
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const BOTTOM_THRESHOLD_PX = 48;

export function useAutoScroll<T extends HTMLElement>({
	autoScrollTrigger,
	autoScrollEnabled = true,
}: {
	/** Changes whenever new content lands, e.g. the event count. */
	autoScrollTrigger: number;
	autoScrollEnabled?: boolean;
}): {
	autoScrollRef: (node: T | null) => void;
	autoScrollPinned: boolean;
	autoScrollJumpToLatest: () => void;
} {
	const nodeRef = useRef<T | undefined>(undefined);
	const [autoScrollPinned, setAutoScrollPinned] = useState(true);

	const autoScrollRef = useCallback((node: T | null) => {
		nodeRef.current = node ?? undefined;
	}, []);

	// Ownership of the pin flag lives with the scroll listener, not with the
	// content updates, so a burst of frames cannot re-pin behind the reader's back.
	useEffect(() => {
		const node = nodeRef.current;
		if (!node) return;

		const onScroll = () => {
			const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
			setAutoScrollPinned(distanceFromBottom <= BOTTOM_THRESHOLD_PX);
		};

		node.addEventListener("scroll", onScroll, { passive: true });
		return () => node.removeEventListener("scroll", onScroll);
	}, [autoScrollTrigger]);

	useEffect(() => {
		if (!autoScrollEnabled || !autoScrollPinned) return;
		const node = nodeRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
	}, [autoScrollTrigger, autoScrollEnabled, autoScrollPinned]);

	const autoScrollJumpToLatest = useCallback(() => {
		const node = nodeRef.current;
		if (!node) return;
		node.scrollTop = node.scrollHeight;
		setAutoScrollPinned(true);
	}, []);

	return { autoScrollRef, autoScrollPinned, autoScrollJumpToLatest };
}
