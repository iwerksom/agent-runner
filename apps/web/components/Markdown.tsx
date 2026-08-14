/**
 * Purpose: render the markdown Arnold actually produces — work orders, PR-loop
 * reports, assistant messages — without a markdown dependency. The subset is
 * fixed and small: headings, lists, fenced code, block quotes, pipe tables,
 * rules, and inline code / bold / italic / links.
 *
 * Nothing is rendered as HTML. Artifact bodies and assistant text can contain
 * text an agent read from Jira or a PR comment, which is untrusted input, so
 * every node here is a React element built from plain strings and there is no
 * dangerouslySetInnerHTML anywhere in the console.
 */

import type { ReactNode } from "react";

const INLINE_SOURCE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]*\]\([^)\s]+\))/;

/** Inline spans. Unmatched text passes through verbatim, including stray markers. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	let cursor = 0;
	let index = 0;

	// Fresh regex per call: a shared /g pattern would carry lastIndex between the
	// nested calls this function makes for table cells and list items.
	const pattern = new RegExp(INLINE_SOURCE.source, "g");
	let match = pattern.exec(text);
	while (match !== null) {
		const token = match[0];
		if (match.index > cursor) {
			nodes.push(text.slice(cursor, match.index));
		}

		if (token.startsWith("`")) {
			nodes.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>);
		} else if (token.startsWith("**")) {
			nodes.push(
				<strong key={`${keyPrefix}-b${index}`} className="font-semibold">
					{token.slice(2, -2)}
				</strong>,
			);
		} else if (token.startsWith("*")) {
			nodes.push(<em key={`${keyPrefix}-i${index}`}>{token.slice(1, -1)}</em>);
		} else {
			const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
			const label = link?.[1] ?? token;
			const href = link?.[2];
			nodes.push(
				href ? (
					<a
						key={`${keyPrefix}-a${index}`}
						href={href}
						target="_blank"
						rel="noreferrer noopener"
					>
						{label || href}
					</a>
				) : (
					token
				),
			);
		}

		cursor = match.index + token.length;
		index += 1;
		match = pattern.exec(text);
	}

	if (cursor < text.length) nodes.push(text.slice(cursor));
	return nodes;
}

function isTableSeparator(line: string): boolean {
	return /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line: string): string[] {
	return line
		.replace(/^\s*\|/, "")
		.replace(/\|\s*$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

export function Markdown({
	markdownSource,
	markdownClassName,
}: {
	markdownSource: string;
	markdownClassName?: string;
}) {
	const lines = markdownSource.replace(/\r\n/g, "\n").split("\n");
	const blocks: ReactNode[] = [];
	let cursor = 0;
	let blockIndex = 0;

	const nextKey = () => {
		blockIndex += 1;
		return `md-${blockIndex}`;
	};

	while (cursor < lines.length) {
		const line = lines[cursor] ?? "";

		if (line.trim() === "") {
			cursor += 1;
			continue;
		}

		// Fenced code. An unterminated fence runs to the end, which is what a
		// truncated artifact looks like and is better than dropping the block.
		const fence = /^\s*```\s*([\w-]*)\s*$/.exec(line);
		if (fence) {
			const language = fence[1] ?? "";
			const body: string[] = [];
			cursor += 1;
			while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor] ?? "")) {
				body.push(lines[cursor] ?? "");
				cursor += 1;
			}
			cursor += 1;
			blocks.push(
				<pre key={nextKey()} data-language={language || undefined}>
					<code>{body.join("\n")}</code>
				</pre>,
			);
			continue;
		}

		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			const level = (heading[1] ?? "#").length;
			const content = renderInline(heading[2] ?? "", nextKey());
			cursor += 1;
			const key = nextKey();
			if (level <= 1) blocks.push(<h1 key={key}>{content}</h1>);
			else if (level === 2) blocks.push(<h2 key={key}>{content}</h2>);
			else if (level === 3) blocks.push(<h3 key={key}>{content}</h3>);
			else blocks.push(<h4 key={key}>{content}</h4>);
			continue;
		}

		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			cursor += 1;
			blocks.push(<hr key={nextKey()} className="border-divider" />);
			continue;
		}

		if (/^\s*>\s?/.test(line)) {
			const quoted: string[] = [];
			while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor] ?? "")) {
				quoted.push((lines[cursor] ?? "").replace(/^\s*>\s?/, ""));
				cursor += 1;
			}
			blocks.push(
				<blockquote key={nextKey()}>
					{renderInline(quoted.join(" "), nextKey())}
				</blockquote>,
			);
			continue;
		}

		// Pipe table: a header row followed by a separator row.
		if (line.includes("|") && isTableSeparator(lines[cursor + 1] ?? "")) {
			const header = splitTableRow(line);
			cursor += 2;
			const rows: string[][] = [];
			while (
				cursor < lines.length &&
				(lines[cursor] ?? "").includes("|") &&
				(lines[cursor] ?? "").trim() !== ""
			) {
				rows.push(splitTableRow(lines[cursor] ?? ""));
				cursor += 1;
			}
			blocks.push(
				<div key={nextKey()} className="overflow-x-auto">
					<table className="w-full border-collapse text-left text-sm">
						<thead>
							<tr className="border-b border-divider">
								{header.map((cell, cellIndex) => (
									<th
										key={`h${cellIndex}`}
										className="px-2 py-1 font-semibold text-default-600"
									>
										{renderInline(cell, `th-${cellIndex}`)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, rowIndex) => (
								<tr key={`r${rowIndex}`} className="border-b border-divider/50">
									{row.map((cell, cellIndex) => (
										<td key={`c${cellIndex}`} className="px-2 py-1 align-top">
											{renderInline(cell, `td-${rowIndex}-${cellIndex}`)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>,
			);
			continue;
		}

		const unordered = /^\s*[-*+]\s+/;
		const ordered = /^\s*\d+[.)]\s+/;
		if (unordered.test(line) || ordered.test(line)) {
			const isOrdered = ordered.test(line);
			const items: string[] = [];
			while (cursor < lines.length) {
				const candidate = lines[cursor] ?? "";
				const matches = isOrdered ? ordered.test(candidate) : unordered.test(candidate);
				if (!matches) break;
				items.push(candidate.replace(isOrdered ? ordered : unordered, ""));
				cursor += 1;
			}
			const key = nextKey();
			const rendered = items.map((item, itemIndex) => (
				<li key={`${key}-li${itemIndex}`}>{renderInline(item, `${key}-li${itemIndex}`)}</li>
			));
			blocks.push(isOrdered ? <ol key={key}>{rendered}</ol> : <ul key={key}>{rendered}</ul>);
			continue;
		}

		// Paragraph: soft-wrapped lines join with a space, as markdown does.
		const paragraph: string[] = [];
		while (cursor < lines.length && (lines[cursor] ?? "").trim() !== "") {
			const candidate = lines[cursor] ?? "";
			if (
				/^(#{1,6})\s+/.test(candidate) ||
				/^\s*```/.test(candidate) ||
				/^\s*>\s?/.test(candidate) ||
				unordered.test(candidate) ||
				ordered.test(candidate)
			) {
				break;
			}
			paragraph.push(candidate);
			cursor += 1;
		}
		const key = nextKey();
		blocks.push(<p key={key}>{renderInline(paragraph.join(" "), key)}</p>);
	}

	return <div className={`arnold-prose ${markdownClassName ?? ""}`}>{blocks}</div>;
}
