/**
 * Purpose: the one empty state in the console. Every list (agents, runs,
 * artifacts, children) uses it, so "nothing here yet" always looks intentional
 * and always has room for the next action.
 */

import { Card, CardBody } from "@heroui/react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
	emptyStateTitle,
	emptyStateDescription,
	emptyStateIcon,
	emptyStateAction,
	emptyStateCompact = false,
}: {
	emptyStateTitle: string;
	emptyStateDescription?: string;
	emptyStateIcon?: ReactNode;
	emptyStateAction?: ReactNode;
	emptyStateCompact?: boolean;
}) {
	return (
		<Card shadow="none" className="border border-dashed border-default-300 bg-transparent">
			<CardBody
				className={`flex flex-col items-center gap-2 text-center ${
					emptyStateCompact ? "py-6" : "py-12"
				}`}
			>
				<div className="text-default-400">
					{emptyStateIcon ?? <Inbox className="h-6 w-6" />}
				</div>
				<p className="text-sm font-medium text-default-700">{emptyStateTitle}</p>
				{emptyStateDescription ? (
					<p className="max-w-md text-xs text-default-500">{emptyStateDescription}</p>
				) : undefined}
				{emptyStateAction ? <div className="mt-2">{emptyStateAction}</div> : undefined}
			</CardBody>
		</Card>
	);
}
