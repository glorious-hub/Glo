#!/usr/bin/env bash
# ci/push-logs.sh BRANCH : keeps the job's logs on a branch of their own (the build logs can then be read with git)
b=$1
[ -d ci-logs ] || exit 0
cd ci-logs || exit 0
rm -f .errlines
git init -q -b "$b"
git add -A
git -c user.name="glok-ci" -c user.email="glok-ci@users.noreply.github.com" commit -q -m "logs run ${GITHUB_RUN_NUMBER} ${GITHUB_SHA}" || exit 0
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$b"
