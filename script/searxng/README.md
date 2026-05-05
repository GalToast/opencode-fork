# Local SearXNG for OpenCodex

This folder runs a local SearXNG endpoint for `websearch` fallback.

## Native Windows

This repo now supports a native Windows SearXNG install for local use without Docker or WSL.

Install it once:

```powershell
pwsh -File script/searxng/install-native.ps1
```

Start it in the background:

```powershell
pwsh -File script/searxng/start-native.ps1
```

Start it and wait for health:

```powershell
pwsh -File script/searxng/start-native.ps1 -WaitForHealth
```

The native service listens on:

```text
http://127.0.0.1:8889
```

## Start

```bash
docker compose -f script/searxng/docker-compose.yml up -d
```

## Start + wait for health (recommended)

```bash
script/searxng/ensure-searxng.sh
```

## Optional: keep WSL alive (for stable localhost port 8080 from Windows)

```powershell
pwsh -File script/searxng/start-wsl-keepalive.ps1
```

Stop it when you are done:

```powershell
pwsh -File script/searxng/stop-wsl-keepalive.ps1
```

## Stop

```bash
docker compose -f script/searxng/docker-compose.yml down
```

## Verify

```bash
curl "http://127.0.0.1:8080/search?q=openai&format=json"
```

If you hit intermittent local proxy/bot-detection warnings, include local IP headers:

```bash
curl -H "X-Forwarded-For: 127.0.0.1" -H "X-Real-IP: 127.0.0.1" \
  "http://127.0.0.1:8080/search?q=openai&format=json"
```

## OpenCodex env

```bash
OPENCODE_ENABLE_EXA=1
OPENCODE_WEBSEARCH_BACKEND=auto
OPENCODE_SEARXNG_URL=http://127.0.0.1:8889
```

`auto` mode uses Exa first and falls back to local SearXNG when Exa is rate-limited or unavailable.
