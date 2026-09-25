# syntax=docker/dockerfile:1

# CloudBank ships as a single container: the Go binary embeds the built React
# SPA and serves both the API and the UI. SQLite lives on the /data volume.
#
# --build-arg DEMO=1 builds the public demo instead (#420): throwaway accounts,
# no setup or login, and everything deleted after two hours without use and
# every night. Published only as :demo, by the docker-demo workflow. Run it
# without a volume: an empty /data on every start is what makes a redeploy a
# reset.

# --- Stage 1: build the web SPA ---
FROM node:26-bookworm-slim AS web
WORKDIR /src/web
# Install dependencies first for better layer caching.
COPY web/package.json web/package-lock.json ./
RUN npm ci
# The OpenAPI spec is the source of the generated TS API types.
COPY api/ /src/api/
COPY web/ ./
ARG DEMO=
# Vite's outDir points at ../server/internal/webui/dist (see vite.config.ts).
RUN npm run gen:api && CB_DEMO="${DEMO}" npm run build

# --- Stage 2: build the Go binary (with the SPA embedded) ---
FROM golang:1.27-bookworm AS build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# Bring in the built SPA so go:embed includes it in the binary.
COPY --from=web /src/server/internal/webui/dist ./internal/webui/dist
# Create the data dir here so it can be copied with the runtime user's
# ownership into the distroless stage (which has no shell to mkdir/chown).
RUN mkdir -p /data
ARG VERSION=dev
ARG DEMO=
RUN tags=""; if [ "${DEMO}" = "1" ]; then tags="demo"; fi; \
    CGO_ENABLED=0 GOOS=linux go build -tags "${tags}" \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/cloudbank ./cmd/cloudbank

# --- Stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="CloudBank" \
      org.opencontainers.image.description="Self-hosted web port of HomeBank" \
      org.opencontainers.image.source="https://github.com/easly1989/cloudbank" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build /out/cloudbank /cloudbank
# Data (SQLite db + backups) persists here. The directory is copied with the
# distroless nonroot uid/gid (65532) so that anonymous volumes (plain
# `docker run`) and named volumes (compose) initialize writable by nonroot —
# otherwise a root-owned /data makes SQLite fail with SQLITE_CANTOPEN (14).
COPY --from=build --chown=65532:65532 /data /data
ENV CB_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
USER nonroot:nonroot
# The image has no shell/curl, so probe via the binary's own subcommand.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/cloudbank", "healthcheck"]
ENTRYPOINT ["/cloudbank"]
