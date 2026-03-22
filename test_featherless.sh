#!/bin/bash
curl -X POST https://api.featherless.ai/v1/chat/completions \
  -H "Authorization: Bearer rc_cd4ee2f2a61c0df4016df770b59b7563dedf3fa7765e78fb9d09f584cbeab0a7" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V3-0324",
    "messages": [
      {"role": "system", "content": "You are a robot command parser. Return JSON with vx, vy, wz, duration, description."},
      {"role": "user", "content": "walk forward 1 meter"}
    ],
    "max_tokens": 200,
    "temperature": 0.1
  }'
