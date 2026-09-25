/**
 * Purpose: Tailwind + HeroUI theme for the Arnold console. Mirrors the
 * first target repo's setup deliberately (HeroUI 2.x plugin, darkMode "class",
 * the same inverted turquoise dark ramp) so operators moving between the two
 * apps read the same surfaces and the same semantic colours.
 *
 * Tailwind 4 loads this file through the `@config` directive in app/globals.css.
 * The content globs are listed twice on purpose: pnpm workspaces hoist
 * @heroui/theme to the repo root, but a local install keeps it under apps/web.
 */

import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";

const config: Config = {
	darkMode: "class",
	// The HeroUI theme dist is deliberately NOT listed here. Tailwind 4 ignores
	// node_modules during content detection, so a glob pointing into it is
	// silently inert; the `@source` directive in app/globals.css is what actually
	// scans it, and the comment there explains what broke without it.
	content: [
		"./app/**/*.{js,mjs,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,mjs,ts,jsx,tsx,mdx}",
		"./hooks/**/*.{js,mjs,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			maxWidth: {
				"main-wrapper": "1840px",
			},
			fontFamily: {
				// The provenance strip and every sha / branch / path is monospaced,
				// because those values are compared by eye against a terminal.
				mono: ["var(--font-arnold-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
			},
			animation: {
				"fade-in-up": "fadeInUp 0.3s ease-out",
			},
			keyframes: {
				fadeInUp: {
					"0%": { opacity: "0", transform: "translateY(10px)" },
					"100%": { opacity: "1", transform: "translateY(0)" },
				},
			},
		},
	},
	plugins: [
		heroui({
			themes: {
				light: {
					colors: {
						background: "rgb(243 244 246)",
						foreground: "#111111",
						divider: "#dddddd",
						focus: "#3f3f46",

						content1: "#ffffff",
						content2: "#f8fafc",
						content3: "#f1f5f9",
						content4: "#e2e8f0",

						default: {
							50: "#fafafa",
							100: "#f4f4f5",
							200: "#e4e4e7",
							300: "#d4d4d8",
							400: "#a1a1aa",
							500: "#71717a",
							600: "#52525b",
							700: "#3f3f46",
							800: "#27272a",
							900: "#18181b",
							DEFAULT: "#d4d4d8",
							foreground: "#111111",
						},

						primary: {
							50: "#fafafa",
							100: "#f4f4f5",
							200: "#e4e4e7",
							300: "#d4d4d8",
							400: "#a1a1aa",
							500: "#71717a",
							600: "#52525b",
							700: "#3f3f46",
							800: "#27272a",
							900: "#18181b",
							DEFAULT: "#18181b",
							foreground: "#ffffff",
						},

						secondary: {
							DEFAULT: "#333333",
							foreground: "#ffffff",
						},
					},
				},
				dark: {
					colors: {
						background: "#0f1117",
						foreground: "#e8eaf0",
						divider: "#3f4560",
						focus: "#00c0bc",

						// Surface hierarchy — each step noticeably lighter than the background
						content1: "#1e2130", // cards, accordions, drawers
						content2: "#252a3a", // nested surfaces, input wrappers
						content3: "#363c52", // hover states, subtle fills
						content4: "#3f4560", // borders, dividers

						// Low steps sit well above content1 so chips and flat buttons
						// stay visible on cards.
						default: {
							50: "#1e2130",
							100: "#2b3044",
							200: "#363c52",
							300: "#434a63",
							400: "#5f6785",
							500: "#8b91a8",
							600: "#b0b7cc",
							700: "#d0d4e4",
							800: "#e8eaf0",
							900: "#f4f5f9",
							DEFAULT: "#434a63",
							foreground: "#e8eaf0",
						},

						// Inverted turquoise scale (50 darkest → 900 lightest); base
						// #00c0bc stays at 500, matching the inverted default ramp.
						primary: {
							50: "#063938",
							100: "#084c4b",
							200: "#056361",
							300: "#037b79",
							400: "#009a97",
							500: "#00c0bc",
							600: "#1bd9d5",
							700: "#55ece9",
							800: "#93f6f3",
							900: "#c5fbf9",
							DEFAULT: "#00c0bc",
							foreground: "#0f1117",
						},

						secondary: {
							DEFAULT: "#7c8cff",
							foreground: "#0f1117",
						},
					},
				},
			},
		}),
	],
};

export default config;
