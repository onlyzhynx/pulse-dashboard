#!/bin/bash
set -e

# Single source of truth: Docker. The container builds the frontend and
# installs deps internally, so no host-side npm install/build is needed.
# (Do NOT run this app under pm2 as well — that creates a second instance on
#  a different database. See README.)

echo "Pulling latest changes..."
git pull

echo "Rebuilding and restarting the container..."
docker compose up -d --build

echo "Pruning old images..."
docker image prune -f >/dev/null 2>&1 || true

echo "Done! App is running via Docker on port ${PORT:-8787}."
