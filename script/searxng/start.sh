#!/bin/bash
# SearXNG startup script for WSL2 Docker
# Workaround for detached mode issue

CONTAINER_NAME="searxng"
PORT="8889"

# Remove existing container
docker rm -f $CONTAINER_NAME 2>/dev/null

# Run container in background mode (not detached)
# This is a workaround for the -d flag causing immediate exit
nohup docker run --name $CONTAINER_NAME \
    -p $PORT:8080 \
    -e GRANIAN_HOST=0.0.0.0 \
    -e SEARXNG_LIMITER=false \
    -v /mnt/c/Users/HP/repos/opencode/script/searxng/searxng-settings.yml:/etc/searxng/settings.yml:ro \
    -v /mnt/c/Users/HP/repos/opencode/script/searxng/limiter.toml:/etc/searxng/limiter.toml:ro \
    searxng/searxng:latest \
    > /tmp/searxng.log 2>&1 &

echo "SearXNG starting... Container: $CONTAINER_NAME, Port: $PORT"
echo "Logs: /tmp/searxng.log"
sleep 5
docker ps --filter "name=$CONTAINER_NAME" --format "{{.Names}}\t{{.Status}}"
