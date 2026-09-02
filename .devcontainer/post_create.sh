#!/bin/bash
set -e

# Skip Claude Code onboarding when using CLAUDE_CODE_OAUTH_TOKEN
echo '{"hasCompletedOnboarding":true,"installMethod":"native"}' > /home/node/.claude/.claude.json

# Clone the oxlint-utils repo
git clone https://${GITHUB_TOKEN}@github.com/dataquail/oxlint-utils.git /workspace/oxlint-utils

# Install dependencies
cd /workspace/oxlint-utils
pnpm install

# Build all packages so everything is ready
pnpm run build:all
