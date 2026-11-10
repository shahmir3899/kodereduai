# Face evaluation: lfw_enroll5

- Run: 2026-11-10 09:13   Model: dlib (face_recognition), jitters 1
- App thresholds: AUTO < 0.4, FLAGGED < 0.55
- People used: 311   Seed: 42

## Identification (closed set)

- People enrolled: 311  (enrolment images per person: 5)
- Probe images evaluated: 3711  (no usable face in 105 more)

| Outcome | Right student | Wrong student |
|---|---|---|
| AUTO_MATCHED | 2388 | 1 |
| FLAGGED | 1268 | 37 |
| IGNORED | 5 | 12 |

- Auto-marked correctly: 64.3% of probes
- Auto-marked WRONG student: 0.03% of probes (0.04% of auto matches)
- Needed human review (FLAGGED): 35.2%
- Ignored (student would be marked absent): 0.5%

## Detection

- Images processed: 5425; embedded: 5265; no face found: 13; rejected by the app quality filter: 147

_Limits: dlib model only (face-api.js `faceapi_v1` is not covered). Public photos are mostly adults and studio/press quality; real classroom results will differ._