# syntax=docker/dockerfile:1
# ^^^ Required for --mount=type=secret support

# ARG before the first FROM so it is usable in both FROM lines
ARG AB_TAG=25.2.110
ARG TCT_VERSION=v3.7.0

# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:24-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Vite bakes VITE_* in at build time, so whether the image serves the AI
# assistant is decided here.  Three values:
#   0 (default) — no AI UI at all
#   gated       — unlocked per browser at /withai, against AI_ACCESS_PASSWORD
#                 in the *running* container; with no such password set, the
#                 gate can never open
#   1 / true    — always on
# The modules are bundled whatever the value; at 0 nothing renders them, and no
# key or provider call is ever possible.
ARG VITE_AI_ENABLED=0
RUN VITE_AI_ENABLED="${VITE_AI_ENABLED}" npm run build

# ── Stage 2: runtime (AnalysisBase + Flask + TopCPToolkit) ───────────────────
ARG AB_TAG
FROM gitlab-registry.cern.ch/atlas/athena/analysisbase:${AB_TAG}

USER root
SHELL ["/bin/bash", "-c"]

# Install pip + Python dependencies into the Athena Python
RUN source /home/atlas/release_setup.sh \
 && python3 -m ensurepip --upgrade 2>/dev/null \
 || (curl -sSL https://bootstrap.pypa.io/get-pip.py | python3)
RUN source /home/atlas/release_setup.sh \
 && python3 -m pip install --quiet flask flask-cors pyyaml pytest

# Install pdflatex for INTnote PDF generation (AlmaLinux 9, AppStream/BaseOS repo only)
# Silently skips if unavailable rather than failing the build.
RUN dnf install -y \
        --disablerepo='*' \
        --enablerepo=appstream \
        --enablerepo=baseos \
        texlive \
        texlive-latex \
        texlive-geometry \
        texlive-amsmath \
        texlive-xcolor \
        texlive-collection-fontsrecommended \
    2>/dev/null \
    || echo "WARNING: texlive not installed — PDF generation will be disabled"

# ── Clone and build TopCPToolkit ─────────────────────────────────────────────
# TopCPToolkit lives at gitlab.cern.ch/atlas/amg/software/TopCPToolkit and is
# publicly readable, so no token is needed.  A CERN GitLab personal access
# token is still accepted (and required for a private fork):
#   docker build --secret id=cern_token,env=CERN_TOKEN ...
# The token is injected only for this RUN step and is never written to any layer.
# TCT_VERSION controls behaviour:
#   (not set / empty) → skip, no TCT in the image
#   "latest"          → clone main branch
#   any other value   → treated as a git tag, e.g. "v3.7.0"
#
# The source tree is KEPT at /opt/TopCPToolkit/source (only .git is removed):
# Athena's CMake installs share/ data files and python/ modules into the build
# tree as symlinks back into the source tree, so deleting the source would
# leave the reference configs (the GUI's TCT catalogue and templates) and the
# TopCPToolkit Python modules dangling.
ARG TCT_REPO=gitlab.cern.ch/atlas/amg/software/TopCPToolkit.git
ARG TCT_VERSION
RUN --mount=type=secret,id=cern_token \
    if [ -z "${TCT_VERSION}" ]; then \
        echo "TCT_VERSION not set — skipping TopCPToolkit build." ; \
        echo "none" > /opt/tct_version.txt ; \
    else \
        CERN_TOKEN=$(cat /run/secrets/cern_token 2>/dev/null || true) ; \
        if [ -n "$CERN_TOKEN" ]; then \
            CLONE_URL="https://oauth2:${CERN_TOKEN}@${TCT_REPO}" ; \
        else \
            echo "No cern_token secret provided — cloning ${TCT_REPO} anonymously." ; \
            CLONE_URL="https://${TCT_REPO}" ; \
        fi ; \
        if [ "${TCT_VERSION}" = "latest" ]; then \
            CLONE_REF="main" ; \
        else \
            CLONE_REF="${TCT_VERSION}" ; \
        fi ; \
        echo "Cloning TopCPToolkit ref: ${CLONE_REF}" ; \
        git clone --depth=1 --branch "${CLONE_REF}" \
            "${CLONE_URL}" \
            /opt/TopCPToolkit/source \
        && unset CERN_TOKEN CLONE_URL \
        && rm -rf /opt/TopCPToolkit/source/.git \
        && echo "${TCT_VERSION}" > /opt/tct_version.txt \
        && source /home/atlas/release_setup.sh \
        && mkdir -p /opt/TopCPToolkit/build \
        && cd /opt/TopCPToolkit/build \
        && cmake /opt/TopCPToolkit/source/source \
        && make -j$(nproc) \
        && cp -r /opt/TopCPToolkit/source/source/ConfigDocumentation /opt/TopCPToolkit/ConfigDocumentation \
        && ls -d /opt/TopCPToolkit/build/*/data/TopCPToolkit/configs \
        && echo "Reference configs: $(find /opt/TopCPToolkit/build/*/data/TopCPToolkit/configs -name '*.yaml' | wc -l) files" ; \
    fi

# ── Clone TopCPToolkit_Examples (analysis example configs) ───────────────
# Since TCT v3.7.0 the toolkit ships only its CI configs; the analysis examples
# live in TopCPToolkit_Examples, which is ATLAS-internal.  A cern_token secret
# is therefore REQUIRED to get them — without one the step is skipped and the
# app simply offers fewer templates and a smaller custom-block catalogue.
# Only Analysis/ is used (reco/particle/parton of each config, plus the
# fragments they `include`).
ARG TCT_EXAMPLES_REPO=gitlab.cern.ch/atlas/amg/software/topcptoolkit_examples.git
ARG TCT_EXAMPLES_REF=main
RUN --mount=type=secret,id=cern_token \
    CERN_TOKEN=$(cat /run/secrets/cern_token 2>/dev/null || true) ; \
    if [ -z "$CERN_TOKEN" ]; then \
        echo "No cern_token secret — skipping TopCPToolkit_Examples (it is ATLAS-internal)." ; \
    elif git clone --depth=1 --branch "${TCT_EXAMPLES_REF}" \
            "https://oauth2:${CERN_TOKEN}@${TCT_EXAMPLES_REPO}" \
            /opt/TopCPToolkit_Examples ; then \
        rm -rf /opt/TopCPToolkit_Examples/.git ; \
        echo "Analysis configs: $(find /opt/TopCPToolkit_Examples/Analysis \
              -name 'reco.yaml' | wc -l) directories" ; \
    else \
        echo "WARNING: could not clone ${TCT_EXAMPLES_REPO} — no analysis examples." >&2 ; \
        rm -rf /opt/TopCPToolkit_Examples ; \
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
