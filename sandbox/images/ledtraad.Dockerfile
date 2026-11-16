# ledtraad's toolchain on top of the base sandbox image (ROADMAP feature 3.1, #66).
#
# Exactly what ledtraad's static CI job installs (.github/workflows/checks.yml):
# the API's light dependencies and pyflakes, not the pipeline stack, torch or the
# 299 MB corpus (not in git, docs/DATA.md). So an agent can byte-compile, import the
# API, run the two mocked test files, validate the JSON and lint; it cannot run the
# golden set or anything that needs `data/`, and its prompt must say so.
#
# Build the base first: pnpm sandbox:build.
FROM arnold-sandbox:dev

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check \
      "fastapi==0.139.0" "pydantic==2.13.4" uvicorn numpy httpx "anthropic==0.116.0" pyflakes

# Source to read, not to import (#75). A review of a library swap has to compare
# what the old and the new library compute, and could not: neither is in the CI
# job's dependencies above. Installed with --no-deps into a directory that is not
# on sys.path, so `import bm25s` still fails exactly as it does in CI and the
# checks keep meaning what they mean there. The manifest opens this directory to
# Read and Grep with `tools.readRoots`. Pin to requirements.txt; rank_bm25 is the
# library bm25s replaced (ledtraad #42) and stays until that swap is settled.
RUN /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check --no-deps \
      --target /opt/reference "bm25s==0.3.15" "rank_bm25==0.2.2" \
 && chmod -R a+rX /opt/reference

# Runs as the host user with a read-only root, so the venv is only ever read and
# `.pyc` files go nowhere (PYTHONDONTWRITEBYTECODE) instead of failing.
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1
