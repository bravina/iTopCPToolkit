# ARG before the first FROM so it is usable in both FROM lines
ARG AB_TAG=25.2.86

# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM --platform=linux/amd64 node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime (AnalysisBase + Flask) ───────────────────────────────────
ARG AB_TAG
FROM --platform=linux/amd64 gitlab-registry.cern.ch/atlas/athena/analysisbase:${AB_TAG}

USER root

# Use bash so we can source the Athena env, then install pip+Flask
# into the exact Python that Athena exposes at runtime.
SHELL ["/bin/bash", "-c"]
RUN source /home/atlas/release_setup.sh \
 && python3 -m ensurepip --upgrade 2>/dev/null \
 || (curl -sSL https://bootstrap.pypa.io/get-pip.py | python3)
RUN source /home/atlas/release_setup.sh \
 && python3 -m pip install --quiet flask flask-cors pyyaml

# Copy backend
COPY backend/ /app/backend/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Startup script — sources Athena env then launches Flask
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

WORKDIR /app
EXPOSE 5000

CMD ["/app/start.sh"]
