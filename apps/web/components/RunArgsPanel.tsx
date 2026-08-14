/**
 * Purpose: the arguments this run was actually dispatched with, each shown next
 * to the slot it was substituted into. This is the other half of the Dispatcher's
 * receipt: the modal shows the mapping before the run, and this shows what the
 * mapping resolved to afterwards.
 *
 * An argument the manifest does not declare is called out rather than dropped —
 * it was sent, so it either means the manifest changed since the run or something
 * bypassed validation, and both are worth seeing.
 */

import { TriangleAlert } from "lucide-react";
import { stringifyPayload } from "@/components/format";
import type { ArgSpec } from "@/components/types";

export function RunArgsPanel({
	runArgsPanelArgs,
	runArgsPanelSpecs,
}: {
	runArgsPanelArgs: Record<string, unknown>;
	runArgsPanelSpecs: ArgSpec[];
}) {
	const entries = Object.entries(runArgsPanelArgs);
	const specByName = new Map(runArgsPanelSpecs.map((spec) => [spec.name, spec]));

	return (
		<section className="rounded-large border border-default-200 bg-content1">
			<header className="flex items-center justify-between border-b border-divider px-4 py-2.5">
				<h2 className="text-sm font-semibold">Arguments as dispatched</h2>
				<span className="text-[11px] text-default-400">
					{entries.length} value{entries.length === 1 ? "" : "s"}
				</span>
			</header>

			{entries.length === 0 ? (
				<p className="px-4 py-3 text-xs text-default-400">
					This run was dispatched with no arguments.
				</p>
			) : (
				<dl className="divide-y divide-divider">
					{entries.map(([name, value]) => {
						const spec = specByName.get(name);
						const rendered = stringifyPayload(value);
						const long = rendered.length > 160 || rendered.includes("\n");

						return (
							<div key={name} className="flex flex-col gap-1 px-4 py-2.5">
								<dt className="flex flex-wrap items-center gap-2">
									<span className="font-mono text-[11px] font-medium text-foreground">
										{name}
									</span>
									{spec ? (
										<code className="rounded bg-content3 px-1.5 py-0.5 font-mono text-[10px] text-default-600">
											{spec.slot}
										</code>
									) : (
										<span className="flex items-center gap-1 text-[10px] text-warning-600">
											<TriangleAlert className="h-3 w-3" />
											not declared in the manifest
										</span>
									)}
								</dt>
								<dd>
									{long ? (
										<details>
											<summary className="cursor-pointer list-none font-mono text-[11px] text-default-500">
												{rendered.replace(/\s+/g, " ").slice(0, 120)}…
											</summary>
											<pre className="arnold-scroll mt-1 max-h-64 overflow-auto rounded bg-content2 p-2 font-mono text-[11px] text-default-600">
												{rendered}
											</pre>
										</details>
									) : (
										<span className="font-mono text-[11px] text-default-600">
											{rendered}
										</span>
									)}
								</dd>
							</div>
						);
					})}
				</dl>
			)}
		</section>
	);
}
