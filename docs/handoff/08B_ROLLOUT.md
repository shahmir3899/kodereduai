# Item B: rollout order, metrics, go / no-go

> **Update 2026-11-09 (owner):** Aura is already ON for all schools, so the Demo School -> Focus order below is **not needed**. What stays useful: `assistant_metrics`
> and `llm_usage` for watching live use, the go / no-go limits as a health check (NO-GO = look at the numbers, or switch one school off with `assistant_switch`),
> and the rollback switches. Skip the staged-rollout steps.

Nothing here turns Aura on for a real school by itself. Each switch is the owner's call.

## Tools that exist

| Need | Command |
|---|---|
| Per-school switch (stored in `School.ai_config`, no schema change) | `python manage.py assistant_switch --school-id N on\|off` and `assistant_switch list` |
| Deployment default for schools without a setting | env `EDU_ASSISTANT_DEFAULT_ENABLED` (start production with it off) |
| Tokens, calls, fallbacks, voice per school and day | `python manage.py llm_usage --days 7 --school-id N --users` |
| Tool success, approval / reject / fail / edit rate, latency, tokens per message, go / no-go | `python manage.py assistant_metrics --school-id N --days 7` |
| Answer quality against the Phase 0 baseline (104 of 127) | `python manage.py assistant_baseline --school-id 37 --mode unified ...` (test school, writes rolled back) |

## Order

1. **Before any real school:** run the baseline on school 37 with the build that will be deployed. It must not fall below 104 of 127 (English 75/87, Roman Urdu 29/40).
2. **Demo School (id 42):** `assistant_switch --school-id 42 on`. Use it for about a week (the owner and the demo accounts; see CLAUDE.md for logins).
3. **Review:** `assistant_metrics --school-id 42 --days 7` and `llm_usage --days 7`. Fill in the table below.
4. **Focus:** only on GO. `assistant_switch --school-id <Focus id> on`; repeat the review after a week.
5. **Any NO-GO:** `assistant_switch ... off` is the rollback (the orb disappears and every assistant endpoint closes). Kill switches for providers: `EDU_LLM_CEREBRAS_ENABLED=false`, `EDU_VOICE_ENABLED=false`.

## Go / no-go table (limits are proposals; the owner can change them in `assistant_metrics.py`)

| Metric | Source | Limit | Demo School | Focus |
|---|---|---|---|---|
| Tool-call success | `AgentAuditLog` (denied calls excluded) | >= 90% | | |
| Cards rejected or failed, of decided cards | `AgentAction` | <= 15% | | |
| Latency p95 per tool call | `AgentAuditLog.duration_ms` | <= 20 s | | |
| Approval rate | `AgentAction` | reported, no limit | | |
| Edit rate | `AgentGap` `card_edited` per card | reported, no limit | | |
| Tokens per message | `AgentUsageDay` / user messages | reported; compare with ~6.9k measured at Phase 0 | | |
| Fallback rate (second provider) | `AgentUsageDay` | reported; see item P | | |
| Baseline pass | `assistant_baseline` on school 37 | >= 104 / 127 | | |

## Caveats

- An edited card that is then approved only shows as "executed" on the card, so the edit rate comes from the learning-loop rows (`AgentGap`). Gap rows are deleted after 90 days.
- The command reads the last N days only; run it weekly and paste the numbers here.
- Latency is per tool call, not per answer; the model time per message is in the logs and `llm_usage` tokens.
