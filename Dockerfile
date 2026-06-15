# syntax=docker/dockerfile:1

# CloudBank ships as a single container: the Go binary embeds the built React
# SPA and serves both the API and the UI. SQLite lives on the /data volume.

# --- Stage 1: build the web SPA ---
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
# Install dependencies first for better layer caching.
COPY web/package.json web/package-lock.json ./
RUN npm ci
# The OpenAPI spec is the source of the generated TS API types.
COPY api/ /src/api/
COPY web/ ./
# Vite's outDir points at ../server/internal/webui/dist (see vite.config.ts).
RUN npm run gen:api && npm run build

# --- Stage 2: build the Go binary (with the SPA embedded) ---
FROM golang:1.25-bookworm AS build
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# Bring in the built SPA so go:embed includes it in the binary.
COPY --from=web /src/server/internal/webui/dist ./internal/webui/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/cloudbank ./cmd/cloudbank

# --- Stage 3: minimal runtime ---
FROM gcr.io/distroless/static-debian12:nonroot
LABEL org.opencontainers.image.title="CloudBank" \
      org.opencontainers.image.description="Self-hosted web port of HomeBank" \
      org.opencontainers.image.source="https://github.com/easly1989/cloudbank" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY --from=build /out/cloudbank /cloudbank
# Data (SQLite db + backups) persists here; nonroot must be able to write it.
ENV CB_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
USER nonroot:nonroot
# The image has no shell/curl, so probe via the binary's own subcommand.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["/cloudbank", "healthcheck"]
ENTRYPOINT ["/cloudbank"]
