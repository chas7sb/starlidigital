FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN python3 -m venv /opt/video-python && /opt/video-python/bin/pip install --no-cache-dir -r video-engine/requirements.txt
RUN npm ci --include=dev && npm run build
ENV PYTHON_BIN=/opt/video-python/bin/python
EXPOSE 4100
CMD ["npm", "run", "start"]
