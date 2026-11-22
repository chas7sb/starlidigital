FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY . .
RUN npm ci --include=dev && npm run build

FROM python:3.11-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ffmpeg libgl1 libglib2.0-0 libsndfile1 pandoc git && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/build /app/build
COPY package.json /app/package.json
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["python", "-m", "uvicorn", "workspace_entry:app", "--host", "0.0.0.0", "--port", "8080"]
