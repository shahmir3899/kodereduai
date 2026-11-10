# Face evaluation: lfw_enroll1

- Run: 2026-11-10 08:00   Model: dlib (face_recognition), jitters 1
- App thresholds: AUTO < 0.4, FLAGGED < 0.55
- People used: 311   Seed: 42

## Identification (closed set)

- People enrolled: 311  (enrolment images per person: 1)
- Probe images evaluated: 4954  (no usable face in 143 more)

| Outcome | Right student | Wrong student |
|---|---|---|
| AUTO_MATCHED | 1609 | 2 |
| FLAGGED | 2986 | 137 |
| IGNORED | 124 | 96 |

- Auto-marked correctly: 32.5% of probes
- Auto-marked WRONG student: 0.04% of probes (0.12% of auto matches)
- Needed human review (FLAGGED): 63.0%
- Ignored (student would be marked absent): 4.4%

## Detection

- Images processed: 5425; embedded: 5265; no face found: 13; rejected by the app quality filter: 147

_Limits: dlib model only (face-api.js `faceapi_v1` is not covered). Public photos are mostly adults and studio/press quality; real classroom results will differ._