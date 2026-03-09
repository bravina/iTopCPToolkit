# syntax=docker/dockerfile:1
# ^^^ Required for --mount=type=secret support

# ARG before the first FROM so it is usable in both FROM lines
ARG AB_TAG=25.2.86
ARG TCT_VERSION=v2.24.0

# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM --platform=linux/amd64 node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime (AnalysisBase + Flask + TopCPToolkit) ───────────────────
ARG AB_TAG
FROM --platform=linux/amd64 gitlab-registry.cern.ch/atlas/athena/analysisbase:${AB_TAG}

USER root
SHELL ["/bin/bash", "-c"]

# Install pip + Python dependencies into the Athena Python
RUN source /home/atlas/release_setup.sh \
 && python3 -m ensurepip --upgrade 2>/dev/null \
 || (curl -sSL https://bootstrap.pypa.io/get-pip.py | python3)
RUN source /home/atlas/release_setup.sh \
 && python3 -m pip install --quiet flask flask-cors pyyaml

# ── Clone and build TopCPToolkit ─────────────────────────────────────────────
# Pass your CERN GitLab personal access token at build time:
#   docker build --secret id=cern_token,env=CERN_TOKEN ...
# The token is injected only for this RUN step and is never written to any layer.
# TCT_VERSION controls behaviour:
#   (not set / empty) → skip, no TCT in the image
#   "latest"          → clone main branch
#   any other value   → treated as a git tag, e.g. "v2.24.0"
ARG TCT_VERSION
RUN --mount=type=secret,id=cern_token \
    if [ -z "${TCT_VERSION}" ]; then \
        echo "TCT_VERSION not set — skipping TopCPToolkit build." ; \
        echo "none" > /opt/tct_version.txt ; \
    else \
        CERN_TOKEN=$(cat /run/secrets/cern_token 2>/dev/null || true) ; \
        if [ -z "$CERN_TOKEN" ]; then \
            echo "ERROR: TCT_VERSION is set but no cern_token secret was provided." >&2 ; \
            exit 1 ; \
        fi ; \
        if [ "${TCT_VERSION}" = "latest" ]; then \
            CLONE_REF="main" ; \
        else \
            CLONE_REF="${TCT_VERSION}" ; \
        fi ; \
        echo "Cloning TopCPToolkit ref: ${CLONE_REF}" ; \
        git clone --depth=1 --branch "${CLONE_REF}" \
            "https://oauth2:${CERN_TOKEN}@gitlab.cern.ch/atlasphys-top/reco/TopCPToolkit.git" \
            /tmp/TopCPToolkit-src \
        && unset CERN_TOKEN \
        && echo "${TCT_VERSION}" > /opt/tct_version.txt \
        && source /home/atlas/release_setup.sh \
        && mkdir -p /opt/TopCPToolkit/build \
        && cd /opt/TopCPToolkit/build \
        && cmake /tmp/TopCPToolkit-src/source \
        && make -j$(nproc) \
        && rm -rf /tmp/TopCPToolkit-src ; \
    fi

# Copy backend
COPY backend/ /app/backend/
COPY VERSION /app/VERSION

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Startup script — sources Athena env then launches Flask
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# OpenShift runs containers as a random non-root UID.
# Make /app and /opt world-writable so those UIDs can write logs/temp files.
RUN chown -R 0:0 /app /opt && chmod -R g=u /app /opt

WORKDIR /app
EXPOSE 5000

CMD ["/app/start.sh"]
