# OpenCode Studio for Seqera Platform

ARG CONNECT_CLIENT_VERSION="0.9.0"
ARG OPENCODE_VERSION="1.4.3"

# Stage 1: Seqera connect-client
FROM --platform=linux/amd64 public.cr.seqera.io/platform/connect-client:${CONNECT_CLIENT_VERSION} AS connect

# Stage 2: Install OpenCode using the official installer into /root/.opencode/bin
FROM --platform=linux/amd64 debian:bookworm-slim AS opencode-installer
ARG OPENCODE_VERSION
RUN apt-get update --yes && apt-get install --yes --no-install-recommends \
    ca-certificates \
    curl \
    tar \
    unzip \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://opencode.ai/install | bash -s -- --version ${OPENCODE_VERSION} --no-modify-path
RUN /root/.opencode/bin/opencode --version

# Stage 3: Final runtime image
# NOTE: Must run as root for connect-client / Fusion loop-device setup
FROM --platform=linux/amd64 debian:bookworm-slim
ARG OPENCODE_VERSION

RUN apt-get update --yes && apt-get install --yes --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    procps \
    ripgrep \
    sudo \
    tar \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Copy connect client from Seqera base image and install early
COPY --from=connect /usr/bin/connect-client /usr/bin/connect-client
RUN /usr/bin/connect-client --install

# Copy OpenCode from installer stage
COPY --from=opencode-installer /root/.opencode/bin/opencode /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode && opencode --version

# Bake in a minimal OpenCode config so the container does not try to resolve
# extra plugins on first boot.
RUN mkdir -p /root/.config/opencode
COPY opencode.jsonc /root/.config/opencode/opencode.jsonc

WORKDIR /workspace
RUN mkdir -p /workspace

COPY start.sh /usr/local/bin/start.sh
RUN chmod +x /usr/local/bin/start.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${CONNECT_TOOL_PORT:-8080}/" >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/connect-client", "--entrypoint", "/usr/local/bin/start.sh"]
