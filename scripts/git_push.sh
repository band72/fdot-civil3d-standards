#!/usr/bin/env bash
# Manual Git Push and Merge Script
# scripts/git_push.sh
#
# Inspects local and remote git status, tests build integrity,
# merges upstream changes if diverged, and pushes to origin master.
#
# Usage:
#   bash scripts/git_push.sh                    # auto-generated commit message
#   bash scripts/git_push.sh "commit message"    # your own message
set -euo pipefail
cd "$(dirname "$0")/.."

echo "════════════════════════════════════════════════════════"
echo "  1. Verify Working Tree & Commit Pending Changes"
echo "════════════════════════════════════════════════════════"

git status

if [ -n "$(git status --porcelain)" ]; then
    echo "Staging pending working-tree changes..."
    # -A (not a fixed list of directories): a prior version of this script only ran
    # `git add core/ plugins/ tests/ scripts/`, which silently left anything outside those
    # four directories (index.html, README.md, docs/, db/, server.py, package.json, ...)
    # unstaged — committed and pushed would go on without it, no warning given. Reproduced
    # concretely: editing README.md and running that exact `git add` left it unstaged.
    git add -A

    if [ $# -ge 1 ]; then
        COMMIT_MSG="$1"
    else
        # No message given: summarize which files changed rather than reusing a stale,
        # hardcoded description from whatever this script's own commit happened to be for
        # the day it was written — that string would be wrong for every future run.
        CHANGED=$(git diff --cached --name-only | sed 's/^/  - /')
        COMMIT_MSG=$(printf 'chore: sync local changes\n\n%s' "$CHANGED")
    fi
    git commit -m "$COMMIT_MSG"
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
    if ! git merge origin/master -m "merge: integrate remote changes from origin/master"; then
        echo
        echo "✗ Merge conflict — resolve it by hand, then:"
        echo "    git add <resolved files>"
        echo "    git commit"
        echo "    bash scripts/git_push.sh"
        echo "  (or 'git merge --abort' to back out of the merge entirely)"
        exit 1
    fi
fi

echo
echo "════════════════════════════════════════════════════════"
echo "  4. Execute Push to Remote"
echo "════════════════════════════════════════════════════════"
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "master" ]; then
    echo "✗ On branch '$CURRENT_BRANCH', not master — refusing to push it onto origin/master."
    echo "  Push it to its own branch instead: git push -u origin $CURRENT_BRANCH"
    exit 1
fi
echo "Pushing master -> origin/master..."
git push origin master

echo
echo "✓ Successfully pushed to origin/master."
