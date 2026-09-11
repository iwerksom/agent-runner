/**
 * Purpose: manage the target repositories Arnold can run against. Onboarding a
 * repo used to mean editing `TARGET_REPO_*` in `.env.local` and re-running
 * `pnpm seed`, which meant a shell, a restart, and exactly one repo. This page
 * is where that moved.
 *
 * Archived repos are included here and nowhere else. They keep their run history
 * and the runs list still links to them, so a screen that manages repos has to
 * show the ones that have been retired — otherwise that history points at
 * something the console denies exists.
 *
 * Server component; every mutation is a client component below it.
 */

import { FolderGit2 } from "lucide-react";
import { RepoAdminList } from "@/components/RepoAdminList";
import { fetchRepos } from "@/components/api";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
	const repos = await fetchRepos({ includeArchived: true });

	const activeCount = repos.filter((repo) => repo.archivedAt === undefined).length;
	const archivedCount = repos.length - activeCount;
	const detachedCount = repos.filter(
		(repo) => repo.archivedAt === undefined && repo.localPath === undefined,
	).length;

	return (
		<div className="flex flex-col gap-5">
			<header className="flex flex-col gap-1">
				<h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
					<FolderGit2 className="h-5 w-5 text-default-400" />
					Repositories
				</h1>
				<p className="text-sm text-default-500">
					{activeCount} active
					{archivedCount > 0 ? `, ${archivedCount} archived` : ""}
					{detachedCount > 0
						? ` · ${detachedCount} with no local checkout, which must be cloned from its remote`
						: ""}
				</p>
			</header>

			<RepoAdminList repoAdminListRepos={repos} />

			<p className="text-[11px] text-default-400">
				A repo is where a run happens, not what it may do. What an agent is allowed to
				change is its manifest&apos;s write scope, enforced by the tool policy on every run.
			</p>
		</div>
	);
}
