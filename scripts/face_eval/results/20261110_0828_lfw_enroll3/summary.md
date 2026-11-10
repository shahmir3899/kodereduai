# Face evaluation: lfw_enroll3

- Run: 2026-11-10 08:28   Model: dlib (face_recognition), jitters 1
- App thresholds: AUTO < 0.4, FLAGGED < 0.55
- People used: 311   Seed: 42

## Identification (closed set)

- People enrolled: 311  (enrolment images per person: 3)
- Probe images evaluated: 4332  (no usable face in 129 more)

| Outcome | Right student | Wrong student |
|---|---|---|
| AUTO_MATCHED | 2402 | 2 |
| FLAGGED | 1851 | 41 |
| IGNORED | 17 | 19 |

- Auto-marked correctly: 55.4% of probes
- Auto-marked WRONG student: 0.05% of probes (0.08% of auto matches)
- Needed human review (FLAGGED): 43.7%
- Ignored (student would be marked absent): 0.8%

## Detection

- Images processed: 5425; embedded: 5265; no face found: 13; rejected by the app quality filter: 147

_Limits: dlib model only (face-api.js `faceapi_v1` is not covered). Public photos are mostly adults and studio/press quality; real classroom results will differ._