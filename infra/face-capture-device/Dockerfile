# Tier B on-prem face-capture device image.
#
# Builds dlib from source (via face_recognition), which needs cmake and a
# C++ toolchain — that's the whole reason for the two-stage build: keep
# those ~1GB of build tools out of the image schools actually run.

FROM python:3.11-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


FROM python:3.11-slim-bookworm

# opencv-python needs libGL/libglib at runtime even with no display attached
# (headless containers hit "libGL.so.1: cannot open shared object file"
# without these) — this is the standard fix, not optional.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

WORKDIR /app
COPY app/ ./app/

ENTRYPOINT ["python", "app/capture.py"]
