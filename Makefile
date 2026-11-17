BUN_IMAGE ?= oven/bun:1.3.6
DOCKER ?= docker
BUN = $(DOCKER) run --rm --user $(shell id -u):$(shell id -g) -e HOME=/tmp -e BUN_INSTALL_CACHE_DIR=/tmp/bun-cache -v "$(CURDIR):/app" -w /app $(BUN_IMAGE) bun

.PHONY: setup test typecheck build smoke verify

setup:
	$(BUN) install --frozen-lockfile

test:
	$(BUN) test

typecheck:
	$(BUN) run typecheck

build:
	$(BUN) run build

smoke: build
	$(BUN) -e 'import plugin from "./dist/index.js"; if (plugin.id !== "opencode-fallback" || typeof plugin.setup !== "function") throw new Error("Invalid plugin entrypoint")'

verify: test typecheck smoke
