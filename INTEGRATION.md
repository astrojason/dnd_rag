# Token Tracker Integration Guide

**Base URL:** `https://token-tracker-roan.vercel.app`  
**Daily Limit:** 250,000 tokens (resets at 00:00 UTC)

---

## JavaScript

```js
const TRACKER = "https://token-tracker-roan.vercel.app/api/tokens";
const DAILY_LIMIT = 250000;

async function getTokensUsed() {
  const res = await fetch(TRACKER);
  const { tokens } = await res.json();
  return tokens;
}

async function reportTokens(count) {
  await fetch(TRACKER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens: count }),
  });
}

async function callAI(prompt) {
  const used = await getTokensUsed();
  if (used >= DAILY_LIMIT) {
    throw new Error(`Daily token limit reached (${used.toLocaleString()} / ${DAILY_LIMIT.toLocaleString()})`);
  }

  const response = await anthropic.messages.create({ /* your params */ });

  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens;
  await reportTokens(tokensUsed);

  return response;
}
```

---

## Python

```python
import httpx

TRACKER = "https://token-tracker-roan.vercel.app/api/tokens"
DAILY_LIMIT = 250_000

def get_tokens_used() -> int:
    res = httpx.get(TRACKER)
    return res.json()["tokens"]

def report_tokens(count: int) -> None:
    httpx.post(TRACKER, json={"tokens": count})

def call_ai(prompt: str):
    used = get_tokens_used()
    if used >= DAILY_LIMIT:
        raise RuntimeError(f"Daily token limit reached ({used:,} / {DAILY_LIMIT:,})")

    response = anthropic.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": prompt}],
    )

    tokens_used = response.usage.input_tokens + response.usage.output_tokens
    report_tokens(tokens_used)

    return response
```

---

## Go

```go
package tokentracker

import (
    "bytes"
    "encoding/json"
    "fmt"
    "net/http"
)

const tracker = "https://token-tracker-roan.vercel.app/api/tokens"
const dailyLimit = 250_000

type tokenResponse struct {
    Date   string `json:"date"`
    Tokens int    `json:"tokens"`
}

func GetTokensUsed() (int, error) {
    res, err := http.Get(tracker)
    if err != nil {
        return 0, err
    }
    defer res.Body.Close()

    var data tokenResponse
    if err := json.NewDecoder(res.Body).Decode(&data); err != nil {
        return 0, err
    }
    return data.Tokens, nil
}

func ReportTokens(count int) error {
    body, _ := json.Marshal(map[string]int{"tokens": count})
    res, err := http.Post(tracker, "application/json", bytes.NewBuffer(body))
    if err != nil {
        return err
    }
    defer res.Body.Close()
    return nil
}

func CheckLimit() error {
    used, err := GetTokensUsed()
    if err != nil {
        return nil // fail open if tracker unreachable
    }
    if used >= dailyLimit {
        return fmt.Errorf("daily token limit reached (%d / %d)", used, dailyLimit)
    }
    return nil
}
```

---

## Notes

- Report `input_tokens + output_tokens` from `response.usage`
- If the tracker is unreachable, fail open (let the call proceed)
- The limit check is advisory — no hard enforcement server-side
