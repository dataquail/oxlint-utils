#!/bin/bash
set -e

# Skip Claude Code onboarding when using CLAUDE_CODE_OAUTH_TOKEN
echo '{"hasCompletedOnboarding":true,"installMethod":"native"}' > /home/node/.claude/.claude.json

# Clone the goodbones repo
git clone https://${GITHUB_TOKEN}@github.com/dataquail/goodbones.git /workspace/goodbones

# Install dependencies
cd /workspace/goodbones
pnpm install

# Build all packages so everything is ready
pnpm run build:all
