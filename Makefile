# CloudBank developer tasks.
#
# Common entry points:
#   make dev      run the backend (use `make web-dev` in another terminal)
#   make gen      regenerate sqlc + OpenAPI/TS types
#   make lint     lint both stacks
#   make test     test both stacks
#   make build    build the web app and the Go binary (embeds the SPA)
#   make docker   build the container image

SERVER_DIR := server
WEB_DIR := web
DIST_DIR := $(SERVER_DIR)/internal/webui/dist
BINARY := $(SERVER_DIR)/bin/cloudbank
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
IMAGE ?= ghcr.io/easly1989/cloudbank

.PHONY: dev web-dev gen lint lint-go lint-web test test-go test-web build web-build go-build docker clean

dev:
	cd $(SERVER_DIR) && go run ./cmd/cloudbank

web-dev:
	cd $(WEB_DIR) && npm run dev

gen:
	@echo ">> regenerating Go code (sqlc, oapi-codegen) — wired in later milestones"
	cd $(SERVER_DIR) && go generate ./... || true
	@echo ">> regenerating TypeScript API types from api/openapi.yaml"
	cd $(WEB_DIR) && npm run gen:api || true

lint: lint-go lint-web

lint-go:
	cd $(SERVER_DIR) && go vet ./...
	cd $(SERVER_DIR) && gofmt -l . | (! grep .) || (echo "gofmt: files need formatting (run gofmt -w)"; exit 1)

lint-web:
	cd $(WEB_DIR) && npm run lint

test: test-go test-web

test-go:
	cd $(SERVER_DIR) && go test ./... -race -count=1

test-web:
	cd $(WEB_DIR) && npm run test

# Build the SPA so the Go binary can embed it.
web-build:
	cd $(WEB_DIR) && npm ci && npm run build

go-build:
	cd $(SERVER_DIR) && CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=$(VERSION)" -o bin/cloudbank ./cmd/cloudbank

build: web-build go-build

docker:
	docker build -t $(IMAGE):dev --build-arg VERSION=$(VERSION) .

clean:
	rm -rf $(SERVER_DIR)/bin $(WEB_DIR)/dist
	find $(DIST_DIR) -mindepth 1 ! -name '.gitkeep' -delete 2>/dev/null || true
