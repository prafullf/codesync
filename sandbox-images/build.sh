#!/bin/sh
# Builds the sandbox runner images used by the worker.
set -eu
PREFIX="${SANDBOX_IMAGE_PREFIX:-codesync-sandbox}"
DIR="$(cd "$(dirname "$0")" && pwd)"
for lang in python node cpp; do
  echo "==> building ${PREFIX}-${lang}"
  docker build -q -t "${PREFIX}-${lang}:latest" "${DIR}/${lang}"
done
