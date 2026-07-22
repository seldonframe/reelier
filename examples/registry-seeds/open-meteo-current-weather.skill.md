---
name: open-meteo-current-weather
description: Current weather for Berlin from the open-meteo forecast API — read-only, no key required
license: MIT
---

# Open-Meteo current weather

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the `latitude`/`longitude` query params for your
  own coordinates.

  Why an agent would replay this: open-meteo is one of the few genuinely
  key-free weather APIs, useful whenever an agent needs a live weather
  read without provisioning an API key. Read-only.

  Endpoint verified live on 2026-07-22: 200, current_weather.temperature a
  number, current_weather.time a string.
-->

The assertions pin the shape (a numeric temperature, a timestamp string),
never the actual reading — weather changes hourly by design.

## Steps

### Step 1 — Current weather for Berlin
- intent: Fetch the current weather for Berlin from open-meteo and confirm a well-formed reading
- action: http.get {"url": "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true"}
- assert: status == 200
- assert: json.current_weather.temperature is number
- assert: json.current_weather.time is string
- bind: temperature = json.current_weather.temperature
- effect: read
