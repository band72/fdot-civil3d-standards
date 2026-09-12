#!/usr/bin/env bash
# Manual Git Push and Merge Script
# scripts/git_push.sh
#
# Inspects local and remote git status, tests build integrity,
# merges upstream changes if diverged, and pushes to origin master.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo "  1. Verify Working Tree & Commit Pending Changes"
echo "════════════════════════════════════════════════════════"

git status

if [ -n "$(git status --porcelain)" ]; then
    echo "Staging pending working-tree changes..."
    git add core/ plugins/ tests/ scripts/
    git commit -m "fix(cms-engine): allow custom template settings passthrough and add client template tests" || true
    echo "✓ Pending changes committed locally."
else
    echo "Working tree is clean."
fi

echo
echo "════════════════════════════════════════════════════════"
echo "  2. Run Test Verification (Pre-Push Gate)"
echo "════════════════════════════════════════════════════════"
npm test
npm run test:db

echo
echo "════════════════════════════════════════════════════════"
echo "  3. Fetch Remote & Inspect Divergence"
echo "════════════════════════════════════════════════════════"
git fetch origin master

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
BASE=$(git merge-base HEAD origin/master)

echo "Local commit:  $LOCAL"
echo "Remote commit: $REMOTE"
echo "Common base:   $BASE"

if [ "$LOCAL" = "$REMOTE" ]; then
    echo "✓ Local and remote are identical. Nothing to push or merge."
    exit 0
elif [ "$REMOTE" = "$BASE" ]; then
    echo "✓ Local is ahead of origin/master. Safe to fast-forward push."
elif [ "$LOCAL" = "$BASE" ]; then
    echo "Notice: Local is behind origin/master. Fast-forwarding..."
    git merge --ff-only origin/master
    exit 0
else
    echo "Notice: Local and remote have diverged. Merging origin/master..."
    git merge origin/master -m "merge: integrate remote changes from origin/master"
fi

echo
echo "════════════════════════════════════════════════════════"
echo "  4. Execute Push to Remote"
echo "════════════════════════════════════════════════════════"
CURRENT_BRANCH=$(git branch --show-current)
echo "Pushing $CURRENT_BRANCH -> origin/master..."
git push origin "$CURRENT_BRANCH:master"

echo
echo "✓ Successfully pushed to origin/master."
