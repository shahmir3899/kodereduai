"""
Tier B on-prem face-capture device.

Samples frames from a fixed camera (RTSP or local device index) every
SAMPLE_INTERVAL_SECONDS, runs face detection + embedding extraction locally
with the same face_recognition/dlib stack the backend uses server-side for
Tier C, and POSTs only the resulting embedding vector + timestamp to
/api/face-attendance/live/match/. Raw video/images never leave this machine.

Configuration is entirely via environment variables (see .env.example) so
the same image runs unmodified at every school.
"""

import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import cv2
import face_recognition
import numpy as np
import requests

logger = logging.getLogger('face_capture_device')


def _required_env(name):
    value = os.environ.get(name, '').strip()
    if not value:
        logger.error('Missing required environment variable: %s (see .env.example)', name)
        sys.exit(1)
    return value


def load_config():
    camera_source = _required_env('CAMERA_SOURCE')
    # A local device index (e.g. "0") must be passed to OpenCV as an int;
    # an RTSP URL stays a string.
    if camera_source.isdigit():
        camera_source = int(camera_source)

    class_id_raw = os.environ.get('CLASS_ID', '').strip()

    return {
        'camera_source': camera_source,
        'api_base_url': _required_env('API_BASE_URL').rstrip('/'),
        'device_key': _required_env('DEVICE_KEY'),
        'embedding_version': os.environ.get('EMBEDDING_VERSION', 'dlib_v1').strip(),
        'sample_interval_seconds': float(os.environ.get('SAMPLE_INTERVAL_SECONDS', '3')),
        'min_face_size': int(os.environ.get('MIN_FACE_SIZE', '60')),
        'class_id': int(class_id_raw) if class_id_raw else None,
        'request_timeout_seconds': float(os.environ.get('REQUEST_TIMEOUT_SECONDS', '10')),
    }


class GracefulShutdown:
    """Lets a `docker stop` (SIGTERM) or Ctrl+C (SIGINT) exit the loop cleanly."""

    def __init__(self):
        self.should_stop = False
        signal.signal(signal.SIGTERM, self._handle)
        signal.signal(signal.SIGINT, self._handle)

    def _handle(self, signum, frame):
        logger.info('Received shutdown signal, stopping after current frame...')
        self.should_stop = True


def open_camera(camera_source):
    cap = cv2.VideoCapture(camera_source)
    if not cap.isOpened():
        logger.error('Could not open camera source: %s', camera_source)
        return None
    logger.info('Camera opened: %s', camera_source)
    return cap


def face_passes_quality(location, min_face_size):
    top, right, bottom, left = location
    width = right - left
    height = bottom - top
    return width >= min_face_size and height >= min_face_size


def post_match(config, embedding, session):
    payload = {
        'embedding': embedding.tolist(),
        'embedding_version': config['embedding_version'],
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    if config['class_id'] is not None:
        payload['class_id'] = config['class_id']

    url = f"{config['api_base_url']}/api/face-attendance/live/match/"
    try:
        response = session.post(
            url,
            json=payload,
            headers={'X-Device-Key': config['device_key']},
            timeout=config['request_timeout_seconds'],
        )
    except requests.RequestException as exc:
        logger.warning('Failed to reach backend: %s', exc)
        return

    if response.status_code != 200:
        logger.warning('Backend rejected match (%s): %s', response.status_code, response.text[:300])
        return

    result = response.json()
    student = result.get('student')
    if student:
        logger.info(
            'Match: %s (%.1f%% confidence) — attendance_marked=%s',
            student['name'], result.get('confidence', 0), result.get('attendance_marked'),
        )
    else:
        logger.info('No match (%s)', result.get('match_status'))


def process_frame(frame, config, session):
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    locations = face_recognition.face_locations(rgb_frame, model='hog')
    locations = [loc for loc in locations if face_passes_quality(loc, config['min_face_size'])]
    if not locations:
        return

    encodings = face_recognition.face_encodings(rgb_frame, known_face_locations=locations)
    for encoding in encodings:
        post_match(config, encoding.astype(np.float64), session)


def run(config):
    shutdown = GracefulShutdown()
    session = requests.Session()

    cap = open_camera(config['camera_source'])
    last_sample_at = 0.0

    while not shutdown.should_stop:
        if cap is None:
            time.sleep(5)
            cap = open_camera(config['camera_source'])
            continue

        ok, frame = cap.read()
        if not ok:
            logger.warning('Camera read failed, reconnecting in 5s...')
            cap.release()
            cap = None
            time.sleep(5)
            continue

        now = time.monotonic()
        if now - last_sample_at < config['sample_interval_seconds']:
            continue
        last_sample_at = now

        try:
            process_frame(frame, config, session)
        except Exception:
            logger.exception('Error processing frame — skipping')

    if cap is not None:
        cap.release()
    logger.info('Stopped.')


def main():
    logging.basicConfig(
        level=os.environ.get('LOG_LEVEL', 'INFO'),
        format='%(asctime)s %(levelname)s %(message)s',
    )
    config = load_config()
    logger.info(
        'Starting face-capture-device: source=%s interval=%ss version=%s',
        config['camera_source'], config['sample_interval_seconds'], config['embedding_version'],
    )
    run(config)


if __name__ == '__main__':
    main()
