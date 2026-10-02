# Features

How work is tracked in Arnold. These rules are deliberate; keep to them.

- **`docs/ROADMAP.md` is the single source of truth.** Always talk about its
  phases ("Phase 7"), never about step numbers from other documents.
- **Features are made in phases.** A feature is numbered `<phase>.<n>`: feature
  `7.2` is the second feature of Phase 7. The number is the same in the roadmap,
  here, and in issue titles (`[7.2] ...`).
- **A feature has tasks, which are GitHub issues.** The feature doc lists them;
  each issue title carries its feature number. GitHub sub-issues are not used.
- **A feature is described as a user story:** "As a [role] I want [goal] so that
  [benefit]".
- One file per feature: `docs/features/<number>-<slug>.md`, with the story, its
  issues, acceptance criteria and notes. When a task closes, update the feature
  doc and the roadmap in the same change as the boards.
- Work that fits no phase is a gap in the roadmap: add it to a phase before
  building it.
