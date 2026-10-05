# The sandbox image every Arnold run executes in (ROADMAP feature 2.1).
#
# It carries only what the agents' allow-lists use. The `claude` binary is NOT
# in the image: it is bind-mounted read-only from the SDK's node_modules so its
# version always matches the pinned SDK. A repo's toolchain is an extra layer in
# sandbox/images/<slug>.Dockerfile (DECISIONS #33).
FROM ubuntu:24.04

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gh ripgrep less procps \
 && rm -rf /var/lib/apt/lists/*

# Runs as the host user (docker run --user), so there is no USER here and the
# image has no home directory of its own: HOME is a tmpfs per run.
ENV HOME=/tmp/home
WORKDIR /tmp
