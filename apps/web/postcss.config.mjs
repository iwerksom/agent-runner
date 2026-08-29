/**
 * Purpose: PostCSS pipeline for the web app. Tailwind 4 runs as a PostCSS
 * plugin (@tailwindcss/postcss); the legacy JS config with the HeroUI plugin is
 * pulled in from app/globals.css via `@config`.
 */

const config = {
	plugins: {
		"@tailwindcss/postcss": {},
	},
};

export default config;
