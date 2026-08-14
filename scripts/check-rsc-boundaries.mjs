/**
 * Purpose: fail the build when a Server Component renders a HeroUI component that
 * introspects its own children. That combination does not error at compile time,
 * so without this check it ships and breaks at request time.
 *
 * Two real failures this catches, both hit on the agent detail page:
 *
 *   Tooltip  ->  its source does
 *                  if (!isValidElement(children)) trigger = jsx("p", {...})
 *                Children built in a Server Component are not valid elements when
 *                Tooltip runs, so it wraps them in a <p>. A Chip renders a <div>,
 *                and <div> inside <p> is invalid HTML: hydration error.
 *
 *   Table    ->  React Aria's collection builder walks its children and needs real
 *                elements. From a Server Component it throws
 *                  Unknown element <[object Object]> in collection
 *
 * The fix is always the same: put `"use client"` at the top of the file. These
 * components take serialisable props, so the boundary costs almost nothing.
 *
 * Run: node scripts/check-rsc-boundaries.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const searchRoots = [join(repoRoot, "apps/web/app"), join(repoRoot, "apps/web/components")];

/**
 * HeroUI components that read their own children. Anything that builds a React
 * Aria collection, or clones/validates a single child, belongs here. Add to this
 * list when adopting a new HeroUI component with either behaviour.
 */
const CHILD_INTROSPECTING = [
	"Tooltip",
	"Table",
	"TableHeader",
	"TableBody",
	"Accordion",
	"Tabs",
	"Select",
	"Listbox",
	"Autocomplete",
	"Dropdown",
	"DropdownMenu",
	"Breadcrumbs",
	"Menu",
	"Popover",
	"Modal",
];

function walk(dir, files = []) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return files;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			walk(full, files);
		} else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
			files.push(full);
		}
	}
	return files;
}

/**
 * The directive is only a directive when it precedes every statement, but comment
 * blocks may come first. So: is there a `"use client"` line before the first
 * import or other statement?
 */
function isClientComponent(source) {
	const lines = source.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*"))
			continue;
		if (trimmed.startsWith("*/")) continue;
		if (/^"use client";?$/.test(trimmed) || /^'use client';?$/.test(trimmed)) return true;
		// First real statement reached without finding the directive.
		return false;
	}
	return false;
}

/** Only counts names actually imported from HeroUI, so a local `Table` is ignored. */
function heroUiImports(source) {
	const found = new Set();
	const importRe = /import\s*\{([^}]*)\}\s*from\s*"@heroui\/[^"]*";/g;
	let match;
	while ((match = importRe.exec(source)) !== null) {
		for (const raw of match[1].split(",")) {
			const name = raw
				.trim()
				.split(/\s+as\s+/)[0]
				.trim();
			if (name !== "") found.add(name);
		}
	}
	return found;
}

const violations = [];
for (const root of searchRoots) {
	for (const file of walk(root)) {
		const source = readFileSync(file, "utf8");
		if (isClientComponent(source)) continue;
		const imported = heroUiImports(source);
		const offending = CHILD_INTROSPECTING.filter((name) => imported.has(name));
		if (offending.length > 0) {
			violations.push({ file: relative(repoRoot, file), offending });
		}
	}
}

if (violations.length === 0) {
	console.log(
		"check-rsc-boundaries: ok, no Server Component renders a child-introspecting HeroUI component",
	);
	process.exit(0);
}

console.error("");
console.error("check-rsc-boundaries: these are Server Components rendering HeroUI components");
console.error("that read their own children. They will fail at request time, not at build time.");
console.error("");
for (const violation of violations) {
	console.error(`  ${violation.file}`);
	console.error(`    imports: ${violation.offending.join(", ")}`);
}
console.error("");
console.error('Fix: add "use client"; as the first statement in each file above.');
console.error("");
process.exit(1);
