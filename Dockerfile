# Resurgo web: the built React app and the read-only runs API in one container.
# Build from the repo root: docker build -t resurgo-web .

# 1. Build web/ to static files.
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. The API: fastapi and uvicorn at the versions locked in uv.lock, nothing else from the project.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNS_DIR=/runs \
    QUEUE_DIR=/queue

WORKDIR /app

# uv only turns uv.lock into a constraints file; the two packages are then installed under it, so
# their dependencies come in at the locked versions and the rest of the project (langgraph, ...) does not.
COPY pyproject.toml uv.lock ./
RUN pip install --no-cache-dir uv \
 && uv export --frozen --no-dev --no-emit-project --no-hashes -o /tmp/constraints.txt \
 && uv pip install --system --no-cache -c /tmp/constraints.txt fastapi uvicorn \
 && pip uninstall -y uv \
 && rm -f /tmp/constraints.txt pyproject.toml uv.lock

COPY api/ ./api/
COPY --from=web /src/web/dist ./web/dist

# uid 1000 is the host account that owns the queue directory, so the worker can read and remove
# the request files the API writes. Everything under /app is read-only to it; nothing is written there.
RUN useradd --uid 1000 --no-create-home resurgo
USER 1000:1000

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
