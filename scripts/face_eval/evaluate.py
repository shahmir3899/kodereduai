"""
Offline face-recognition accuracy evaluation (Phase 1 of the face-attendance upgrade).

Measures the SAME detector / embedder / thresholds the app uses, in memory only:
no database reads or writes, no settings changes.

Data layout (LFW uses this layout natively):
    <data-dir>/<person_name>/<any_image>.jpg

Modes
    pairs     verification: same-person vs different-person distance distributions,
              false-accept / false-reject at the app's thresholds, threshold sweep.
    identify  closed-set identification: first --enroll-n images per person are
              "enrolled", the rest are probes matched against everyone enrolled.
              Reports the AUTO / FLAGGED / IGNORED outcome split, as the app would.
    group     (optional) --group-dir with labels.csv (columns: photo,student) listing
              who is present in each group photo; people must also exist in data-dir.

Run (from repo root, with a Python that has face_recognition):
    python scripts/face_eval/evaluate.py --data-dir <dir> --mode both --max-people 600

Limits: this evaluates the dlib model only. The browser face-api.js model
(faceapi_v1) cannot be run from Python.
"""

import argparse
import csv
import os
import random
import sys
import warnings
from datetime import datetime
from pathlib import Path

warnings.filterwarnings('ignore')

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django  # noqa: E402

django.setup()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from django.conf import settings  # noqa: E402

from face_attendance.services.face_detector import FaceDetector  # noqa: E402
from face_attendance.services.matcher import distance_to_confidence, get_thresholds  # noqa: E402

IMG_EXT = {'.jpg', '.jpeg', '.png', '.bmp'}


def load_rgb(path):
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        return None
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


class Embedder:
    """Detect -> quality filter -> embed, mirroring FaceAttendancePipeline stages 2-3."""

    def __init__(self):
        import face_recognition
        self.fr = face_recognition
        self.detector = FaceDetector()
        self.jitters = settings.FACE_RECOGNITION_SETTINGS.get('NUM_JITTERS', 1)
        self.stats = {'images': 0, 'no_face': 0, 'failed_quality': 0, 'ok': 0}

    def single(self, path):
        """Embedding of the largest quality-passing face, or None."""
        self.stats['images'] += 1
        img = load_rgb(path)
        if img is None:
            self.stats['no_face'] += 1
            return None
        try:
            faces = self.detector.detect_faces(img)
        except ValueError:
            self.stats['no_face'] += 1
            return None
        faces = [f for f in self.detector.filter_quality(img, faces) if f.passed_quality]
        if not faces:
            self.stats['failed_quality'] += 1
            return None
        face = max(faces, key=lambda f: f.width * f.height)
        enc = self.fr.face_encodings(img, known_face_locations=[face.location],
                                     num_jitters=self.jitters)
        if not enc:
            self.stats['no_face'] += 1
            return None
        self.stats['ok'] += 1
        return enc[0]

    def multi(self, path):
        """All quality-passing faces in a group photo -> (n_detected, [embeddings])."""
        img = load_rgb(path)
        if img is None:
            return 0, []
        try:
            faces = self.detector.detect_faces(img)
        except ValueError:
            return 0, []
        good = [f for f in self.detector.filter_quality(img, faces) if f.passed_quality]
        if not good:
            return len(faces), []
        encs = self.fr.face_encodings(img, known_face_locations=[f.location for f in good],
                                      num_jitters=self.jitters)
        return len(faces), list(encs)


def scan_people(data_dir, min_images, max_people, seed):
    people = {}
    for d in sorted(Path(data_dir).iterdir()):
        if not d.is_dir():
            continue
        imgs = sorted(p for p in d.iterdir() if p.suffix.lower() in IMG_EXT)
        if len(imgs) >= min_images:
            people[d.name] = imgs
    names = sorted(people)
    random.Random(seed).shuffle(names)
    return {n: people[n] for n in names[:max_people]}


def outcome(distance, th):
    if distance < th['high']:
        return 'AUTO_MATCHED'
    if distance < th['medium']:
        return 'FLAGGED'
    return 'IGNORED'


# ---------------------------------------------------------------- pairs mode
def run_pairs(emb, people, n_pairs, seed, th, out):
    rng = random.Random(seed)
    cache = {}

    def get(p):
        if p not in cache:
            cache[p] = emb.single(p)
        return cache[p]

    names = list(people)
    pos, neg = [], []
    multi = [n for n in names if len(people[n]) >= 2]
    tries = 0
    while len(pos) < n_pairs and tries < n_pairs * 20:
        tries += 1
        a, b = rng.sample(people[rng.choice(multi)], 2)
        ea, eb = get(a), get(b)
        if ea is not None and eb is not None:
            pos.append(float(np.linalg.norm(ea - eb)))
    tries = 0
    while len(neg) < n_pairs and tries < n_pairs * 20:
        tries += 1
        n1, n2 = rng.sample(names, 2)
        a, b = rng.choice(people[n1]), rng.choice(people[n2])
        ea, eb = get(a), get(b)
        if ea is not None and eb is not None:
            neg.append(float(np.linalg.norm(ea - eb)))

    pos, neg = np.array(pos), np.array(neg)
    if len(pos) == 0 or len(neg) == 0:
        return ['## Verification (pairs)', '',
                '- Not enough usable pairs (no faces detected in the images, or fewer than 2 images per person).']
    lines = ['## Verification (pairs)', '',
             f'- Same-person pairs: {len(pos)}   Different-person pairs: {len(neg)}',
             f'- Same-person distance: mean {pos.mean():.3f}, p95 {np.percentile(pos, 95):.3f}',
             f'- Different-person distance: mean {neg.mean():.3f}, p5 {np.percentile(neg, 5):.3f}', '',
             '| Threshold | False reject (same person rejected) | False accept (different person accepted) |',
             '|---|---|---|']
    sweep = []
    for t in sorted(set([0.30, 0.35, th['high'], 0.45, 0.50, th['medium'], 0.60])):
        fr = float((pos >= t).mean()) * 100
        fa = float((neg < t).mean()) * 100
        tag = ' (app AUTO)' if t == th['high'] else ' (app FLAGGED limit)' if t == th['medium'] else ''
        lines.append(f'| {t:.2f}{tag} | {fr:.1f}% | {fa:.2f}% |')
        sweep.append((t, fr, fa))
    for limit in (0.1, 1.0):
        ok = [t for t in np.arange(0.20, 0.80, 0.01) if (neg < t).mean() * 100 <= limit]
        if ok:
            t = max(ok)
            lines.append('')
            lines.append(f'- Largest threshold keeping false accepts <= {limit}%: '
                         f'{t:.2f} (false rejects then {(pos >= t).mean() * 100:.1f}%)')
    with open(out / 'pairs_distances.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['kind', 'distance'])
        w.writerows([('same', round(d, 4)) for d in pos] + [('different', round(d, 4)) for d in neg])
    return lines


# ------------------------------------------------------------- identify mode
def build_gallery(emb, people, enroll_n):
    gallery, probes = [], []  # gallery: (name, vec); probes: (name, path)
    for name, imgs in people.items():
        enrolled = 0
        for p in imgs:
            if enrolled < enroll_n:
                v = emb.single(p)
                if v is not None:
                    gallery.append((name, v))
                    enrolled += 1
                continue
            probes.append((name, p))
    return gallery, probes


def run_identify(emb, people, enroll_n, th, out):
    gallery, probes = build_gallery(emb, people, enroll_n)
    enrolled_names = {n for n, _ in gallery}
    gvecs = np.array([v for _, v in gallery])
    gnames = [n for n, _ in gallery]
    counts = {'AUTO_MATCHED': [0, 0], 'FLAGGED': [0, 0], 'IGNORED': [0, 0]}  # [correct, wrong]
    no_face = evaluated = 0
    rows = []
    for name, path in probes:
        if name not in enrolled_names:
            continue
        v = emb.single(path)
        if v is None:
            no_face += 1
            continue
        evaluated += 1
        d = np.linalg.norm(gvecs - v, axis=1)
        i = int(d.argmin())
        status = outcome(float(d[i]), th)
        correct = gnames[i] == name
        counts[status][0 if correct else 1] += 1
        rows.append((name, gnames[i], round(float(d[i]), 4), status, correct))
    lines = ['## Identification (closed set)', '',
             f'- People enrolled: {len(enrolled_names)}  (enrolment images per person: {enroll_n})',
             f'- Probe images evaluated: {evaluated}  (no usable face in {no_face} more)', '',
             '| Outcome | Right student | Wrong student |', '|---|---|---|']
    for k, (c, w) in counts.items():
        lines.append(f'| {k} | {c} | {w} |')
    auto_total = sum(counts['AUTO_MATCHED'])
    if evaluated:
        lines += ['',
                  f'- Auto-marked correctly: {counts["AUTO_MATCHED"][0] / evaluated * 100:.1f}% of probes',
                  f'- Auto-marked WRONG student: {counts["AUTO_MATCHED"][1] / evaluated * 100:.2f}% of probes'
                  + (f' ({counts["AUTO_MATCHED"][1] / auto_total * 100:.2f}% of auto matches)' if auto_total else ''),
                  f'- Needed human review (FLAGGED): {sum(counts["FLAGGED"]) / evaluated * 100:.1f}%',
                  f'- Ignored (student would be marked absent): {sum(counts["IGNORED"]) / evaluated * 100:.1f}%']
    with open(out / 'identify_results.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['true_student', 'predicted_student', 'distance', 'outcome', 'correct'])
        w.writerows(rows)
    return lines, gallery


# ---------------------------------------------------------------- group mode
def run_group(emb, gallery, group_dir, th, out):
    group_dir = Path(group_dir)
    labels = {}
    with open(group_dir / 'labels.csv', newline='') as f:
        for r in csv.DictReader(f):
            labels.setdefault(r['photo'], set()).add(r['student'])
    gvecs = np.array([v for _, v in gallery])
    gnames = [n for n, _ in gallery]
    tot_present = tot_detected = tot_right = tot_wrong = 0
    for photo, present in labels.items():
        n_det, encs = emb.multi(group_dir / photo)
        tot_detected += n_det
        tot_present += len(present)
        claims = {}
        for e in encs:
            d = np.linalg.norm(gvecs - e, axis=1)
            i = int(d.argmin())
            if d[i] < th['high'] and (gnames[i] not in claims or d[i] < claims[gnames[i]]):
                claims[gnames[i]] = float(d[i])
        tot_right += len(set(claims) & present)
        tot_wrong += len(set(claims) - present)
    return ['## Group photos', '',
            f'- Photos: {len(labels)}   Labelled present: {tot_present}   Faces detected: {tot_detected}',
            f'- Present students auto-matched: {tot_right} ({tot_right / max(tot_present, 1) * 100:.1f}%)',
            f'- Present but missed (would be marked absent): {tot_present - tot_right}',
            f'- Auto-matched to someone not in the photo: {tot_wrong}']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--mode', choices=['pairs', 'identify', 'both'], default='both')
    ap.add_argument('--group-dir')
    ap.add_argument('--max-people', type=int, default=500)
    ap.add_argument('--min-images', type=int, default=2)
    ap.add_argument('--enroll-n', type=int, default=1)
    ap.add_argument('--pairs', type=int, default=2000)
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--label', default='dataset')
    args = ap.parse_args()

    th = get_thresholds()
    out = Path(__file__).parent / 'results' / f'{datetime.now():%Y%m%d_%H%M}_{args.label}'
    out.mkdir(parents=True, exist_ok=True)

    min_images = max(args.min_images, args.enroll_n + 1) if args.mode != 'pairs' else args.min_images
    people = scan_people(args.data_dir, min_images, args.max_people, args.seed)
    if len(people) < 2:
        sys.exit(f'Need at least 2 people with >= {min_images} images in {args.data_dir}')

    emb = Embedder()
    report = [f'# Face evaluation: {args.label}', '',
              f'- Run: {datetime.now():%Y-%m-%d %H:%M}   Model: dlib (face_recognition), '
              f'jitters {emb.jitters}',
              f'- App thresholds: AUTO < {th["high"]}, FLAGGED < {th["medium"]}',
              f'- People used: {len(people)}   Seed: {args.seed}', '']
    gallery = None
    if args.mode in ('pairs', 'both'):
        report += run_pairs(emb, people, args.pairs, args.seed, th, out) + ['']
    if args.mode in ('identify', 'both'):
        lines, gallery = run_identify(emb, people, args.enroll_n, th, out)
        report += lines + ['']
    if args.group_dir:
        if gallery is None:
            gallery = build_gallery(emb, people, args.enroll_n)[0]
        report += run_group(emb, gallery, args.group_dir, th, out) + ['']
    s = emb.stats
    report += ['## Detection', '',
               f'- Images processed: {s["images"]}; embedded: {s["ok"]}; no face found: {s["no_face"]}; '
               f'rejected by the app quality filter: {s["failed_quality"]}', '',
               '_Limits: dlib model only (face-api.js `faceapi_v1` is not covered). Public photos are mostly '
               'adults and studio/press quality; real classroom results will differ._']
    (out / 'summary.md').write_text('\n'.join(report), encoding='utf-8')
    print('\n'.join(report))
    print(f'\nSaved to {out}')


if __name__ == '__main__':
    main()
