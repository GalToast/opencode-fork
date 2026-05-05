# Adaptive Model Routing

## Overview

Your harness now has **adaptive model routing** that automatically detects slow models and switches to faster alternatives in real-time.

## How It Works

1. **Latency Tracking**: Every LLM call records:
   - Time-to-first-token
   - Total streaming time
   - Exponential moving average (EMA) of latency

2. **Slow Detection**: A model is marked "slow" when:
   - EMA latency > 3000ms (configurable)
   - At least 3 samples collected
   - Or within 60s cooldown after being marked slow

3. **Auto-Failover**: When a model is slow, the router:
   - Finds the fastest available alternative
   - Matches required capabilities (toolcall, reasoning, context)
   - Seamlessly switches without user intervention

## Usage

Enable adaptive routing by setting the environment variable:

```bash
export OPENCODE_ENABLE_ADAPTIVE_ROUTING=true
```

Or in Windows PowerShell:
```powershell
$env:OPENCODE_ENABLE_ADAPTIVE_ROUTING="true"
```

## Testing

Run the test to see it in action:
```bash
cd packages/opencode
bun run test-adaptive-routing.mjs
```

## Configuration

Edit `src/provider/adaptive-router.ts` to tune:
- `SLOW_THRESHOLD_MS`: Threshold for "slow" (default: 3000ms)
- `MIN_SAMPLES`: Minimum samples before marking slow (default: 3)
- `MODEL_COOLDOWN_MS`: Cooldown before retrying slow model (default: 60000ms)
- `LATENCY_WINDOW_SIZE`: Samples for moving average (default: 10)

## Files Modified

1. **src/provider/adaptive-router.ts** - New adaptive router implementation
2. **src/session/prompt.ts** - Added model failover logic
3. **src/session/processor.ts** - Added latency recording
4. **src/flag/flag.ts** - Added OPENCODE_ENABLE_ADAPTIVE_ROUTING flag

## Example Output

```
Is MiniMax-M2.5 slow? true
Recommended alternative: opencode/gpt-5.3-codex
Selected model: opencode/gpt-5.3-codex
```

## Architecture

```
User Request
    ↓
Resolve Model
    ↓
Check if Slow? → Yes → Find Alternative
    ↓                    ↓
   No              Select Fastest
    ↓                    ↓
Use Original ←←←←←← Use Alternative
    ↓
Stream Response
    ↓
Record Latency Metrics
```

## Benefits

- **Automatic**: No manual intervention needed
- **Intelligent**: Learns from real performance data
- **Resilient**: Handles provider degradation gracefully
- **Transparent**: Logs show when switches happen
