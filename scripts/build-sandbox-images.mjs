// Build the base sandbox image, then one layer per repo that declares one
// (sandbox/images/<slug>.Dockerfile -> arnold-sandbox-<slug>:dev). ROADMAP feature 3.1.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sandbox = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sandbox");
const build = (tag, args) => {
	const r = spawnSync("docker", ["build", "-t", tag, ...args, sandbox], { stdio: "inherit" });
	if (r.status !== 0) process.exit(r.status ?? 1);
};

build("arnold-sandbox:dev", []);
for (const file of readdirSync(path.join(sandbox, "images"))) {
	if (!file.endsWith(".Dockerfile")) continue;
	const slug = file.slice(0, -".Dockerfile".length);
	build(`arnold-sandbox-${slug}:dev`, ["-f", path.join(sandbox, "images", file)]);
}
