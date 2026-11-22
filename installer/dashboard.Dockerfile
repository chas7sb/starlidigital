FROM node:22-bookworm-slim AS frontend
WORKDIR /app
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip CYPRESS_INSTALL_BINARY=0 NODE_OPTIONS=--max-old-space-size=6144
COPY dashboard/ .
RUN npm ci --include=dev && npm run build

FROM node:24-bookworm-slim AS provider
WORKDIR /app/platform
COPY platform/ ./
RUN npm ci --include=dev
WORKDIR /app/platform/extensions/starli-runtime
RUN npm ci --include=dev

FROM python:3.11-slim-bookworm
ARG TARGETARCH
RUN test "$TARGETARCH" = "amd64" || (echo 'Dashboard Docker image currently requires linux/amd64; a reviewed Linux ARM64 Python lock is missing.' >&2; exit 1)
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ffmpeg libgl1 libglib2.0-0 libsndfile1 pandoc git && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY packaging/locks/dashboard-linux-x64-py311.txt /tmp/backend-lock.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/backend-lock.txt
COPY dashboard/backend/ ./
COPY --from=frontend /app/build /app/build
COPY dashboard/package.json /app/package.json
COPY --from=provider /usr/local/bin/node /usr/local/bin/node
COPY --from=provider /app/platform /app/platform
ENV DATA_DIR=/data STARLI_PLATFORM_SOURCE_ROOT=/app/platform STARLI_RUNTIME_CODE_DIR=/app/platform/extensions/starli-runtime STARLI_NODE_BINARY=/usr/local/bin/node STARLI_NODE_BIN=/usr/local/bin/node STARLI_PYTHON_BIN=/usr/local/bin/python
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "workspace_entry:app", "--host", "0.0.0.0", "--port", "8080"]
