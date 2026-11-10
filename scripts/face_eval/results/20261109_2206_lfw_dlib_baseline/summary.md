# Face evaluation: lfw_dlib_baseline

- Run: 2026-11-09 22:06   Model: dlib (face_recognition), jitters 1
- App thresholds: AUTO < 0.4, FLAGGED < 0.55
- People used: 400   Seed: 42

## Verification (pairs)

- Same-person pairs: 1000   Different-person pairs: 1000
- Same-person distance: mean 0.434, p95 0.576
- Different-person distance: mean 0.830, p5 0.681

| Threshold | False reject (same person rejected) | False accept (different person accepted) |
|---|---|---|
| 0.30 | 94.4% | 0.00% |
| 0.35 | 84.8% | 0.00% |
| 0.40 (app AUTO) | 62.3% | 0.00% |
| 0.45 | 42.1% | 0.00% |
| 0.50 | 19.2% | 0.00% |
| 0.55 (app FLAGGED limit) | 7.1% | 0.10% |
| 0.60 | 2.2% | 1.00% |

- Largest threshold keeping false accepts <= 0.1%: 0.55 (false rejects then 7.1%)

- Largest threshold keeping false accepts <= 1.0%: 0.60 (false rejects then 2.2%)

## Identification (closed set)

- People enrolled: 400  (enrolment images per person: 1)
- Probe images evaluated: 1807  (no usable face in 45 more)

| Outcome | Right student | Wrong student |
|---|---|---|
| AUTO_MATCHED | 553 | 2 |
| FLAGGED | 1051 | 76 |
| IGNORED | 57 | 68 |

- Auto-marked correctly: 30.6% of probes
- Auto-marked WRONG student: 0.11% of probes (0.36% of auto matches)
- Needed human review (FLAGGED): 62.4%
- Ignored (student would be marked absent): 6.9%

## Detection

- Images processed: 3685; embedded: 3583; no face found: 7; rejected by the app quality filter: 95

_Limits: dlib model only (face-api.js `faceapi_v1` is not covered). Public photos are mostly adults and studio/press quality; real classroom results will differ._