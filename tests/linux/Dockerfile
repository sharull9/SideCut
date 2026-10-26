FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git python3 make g++ sudo \
    xvfb xauth dbus-x11 gnome-keyring libsecret-1-0 \
    libgtk-3-0 libnss3 libasound2 libgbm1 libdrm2 libxss1 libxtst6 \
    libx11-xcb1 libatk-bridge2.0-0 libxkbcommon0 libnotify4 libxrandr2 \
    libxdamage1 libxcomposite1 libxfixes3 libxi6 libxcursor1 libxrender1 \
    libpango-1.0-0 libgl1 fonts-liberation libfuse2 zip xz-utils xdg-utils \
    && rm -rf /var/lib/apt/lists/* \
    && printf 'node ALL=(root) NOPASSWD: /usr/bin/dpkg\n' > /etc/sudoers.d/sidecut-test

USER node
ENV CI=1 VP_VERSION=1.4.0 VP_NODE_MANAGER=no VP_HOME=/home/node/.local/share/vite-plus
ENV PATH="/home/node/.local/share/vite-plus/bin:${PATH}"
RUN curl -fsSL https://vite.plus -o /tmp/install-vp.sh && bash /tmp/install-vp.sh \
    && mkdir -p /home/node/.cache

WORKDIR /workspace
USER root
RUN chown node:node /workspace
USER node
COPY --chown=node:node . .
RUN find scripts tests/linux -name '*.sh' -exec sed -i 's/\r$//' {} +
RUN --mount=type=cache,target=/home/node/.pnpm-store,uid=1000,gid=1000 \
    --mount=type=cache,target=/home/node/.cache/electron,uid=1000,gid=1000 \
    npm_config_store_dir=/home/node/.pnpm-store vp install --frozen-lockfile \
    && vp exec --filter @sidecut/desktop install-electron
RUN vp run lint && vp run typecheck && vp test run --maxWorkers=4
RUN vp run build:desktop && vp exec node scripts/package-desktop.mjs

USER root
RUN chown root:root apps/desktop/release/linux-unpacked/chrome-sandbox \
    && chmod 4755 apps/desktop/release/linux-unpacked/chrome-sandbox
USER node
CMD ["dbus-run-session", "--", "xvfb-run", "-a", "sh", "tests/linux/run-session.sh"]
