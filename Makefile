SHELL := /bin/bash

ifneq (,$(wildcard .env))
include .env
export
endif

COMPOSE := docker compose -f infra/docker-compose.yml
ORACLE_COMPOSE := docker compose -f infra/oracle/docker-compose.yml --env-file infra/oracle/.env
PROD_COMPOSE_FILE ?= infra/production/docker-compose.yml
PROD_ENV_FILE ?= infra/production/.env
PROD_BRANCH ?= main
PROD_SCHEME ?= http
PROD_HOST ?= localhost
PROD_PORT ?= $(if $(filter https,$(PROD_SCHEME)),443,80)
PROD_PORT_SUFFIX = $(if $(filter http:80 https:443,$(PROD_SCHEME):$(PROD_PORT)),,:$(PROD_PORT))
PROD_APP_ORIGIN ?= $(PROD_SCHEME)://$(PROD_HOST)$(PROD_PORT_SUFFIX)
PROD_COMPOSE = COMPOSE_PROFILES="$(PROD_SCHEME)" APP_ORIGIN="$(PROD_APP_ORIGIN)" WEB_PORT="$(PROD_PORT)" FLATHUNTER_PROD_ENV_FILE="$(abspath $(PROD_ENV_FILE))" docker compose -f $(PROD_COMPOSE_FILE) --env-file $(PROD_ENV_FILE)
PROD_COMPOSE_ALL = COMPOSE_PROFILES="http,https" APP_ORIGIN="$(PROD_APP_ORIGIN)" WEB_PORT="$(PROD_PORT)" FLATHUNTER_PROD_ENV_FILE="$(abspath $(PROD_ENV_FILE))" docker compose -f $(PROD_COMPOSE_FILE) --env-file $(PROD_ENV_FILE)
PNPM := pnpm
PNPM_VERSION := 10.33.0
NODE22 := ./scripts/with-node22.sh

.PHONY: help check-env oracle-check-env prod-check-env prod-check-branch prod-check-scheme prod-check-docker check-docker ensure-node ensure-pnpm install infra-up infra-down infra-logs oracle-up oracle-down oracle-logs oracle-config prod-build prod-deploy prod-stop prod-logs prod-config deploy-prod stop-prod migrate dev start worker worker-dev build test typecheck clean

help:
	@echo "FlatHunter Make targets"
	@echo ""
	@echo "  make dev         Start local infra, run migrations, then launch web + api + worker loop"
	@echo "  make worker      Run the batch worker once"
	@echo "  make worker-dev  Run the continuous local worker loop"
	@echo "  make infra-up    Start Postgres and Ollama in Docker"
	@echo "  make infra-down  Stop local Docker services"
	@echo "  make infra-logs  Tail Docker logs"
	@echo "  make oracle-up   Build and start the Oracle production stack"
	@echo "  make oracle-down Stop the Oracle production stack"
	@echo "  make oracle-logs Tail Oracle production logs"
	@echo "  make oracle-config Validate the Oracle docker-compose config"
	@echo "  make prod-deploy Pull, build, migrate, and start the full production stack"
	@echo "  make prod-stop   Stop the full production stack"
	@echo "  make prod-logs   Tail production logs"
	@echo "                  Use PROD_SCHEME=http|https PROD_HOST=... PROD_PORT=..."
	@echo "  make install     Install workspace dependencies"
	@echo "  make migrate     Apply database migrations"
	@echo "  make test        Run the full test suite"
	@echo "  make typecheck   Run TypeScript checks"
	@echo "  make build       Build web, api, and worker"
	@echo "  make clean       Remove local build outputs"
	@echo ""
	@echo "Node 22 is bootstrapped automatically through nvm when available."

check-env:
	@test -f .env || (echo "Missing .env file. Copy .env.example to .env first." && exit 1)
	@test -n "$(PORTAL_SECRETS_KEY)" || (echo "Missing PORTAL_SECRETS_KEY in .env. Generate one with: openssl rand -hex 32" && exit 1)

oracle-check-env:
	@test -f infra/oracle/.env || (echo "Missing infra/oracle/.env file. Copy infra/oracle/.env.example first." && exit 1)

prod-check-env:
	@test -f $(PROD_ENV_FILE) || (echo "Missing $(PROD_ENV_FILE) file. Copy infra/production/.env.example first." && exit 1)

prod-check-branch:
	@branch="$$(git branch --show-current)"; \
	if [ "$$branch" != "$(PROD_BRANCH)" ]; then \
		echo "Production deploy expects branch $(PROD_BRANCH), but current branch is $$branch."; \
		echo "Switch branches or override with: make prod-deploy PROD_BRANCH=$$branch"; \
		exit 1; \
	fi

prod-check-scheme:
	@case "$(PROD_SCHEME)" in \
		http|https) ;; \
		*) echo "PROD_SCHEME must be http or https, got '$(PROD_SCHEME)'."; exit 1 ;; \
	esac

prod-check-docker:
	@docker info >/dev/null 2>&1 || (echo "Docker daemon is not running or this user cannot access it." && echo "Start Docker Engine and ensure the current user can run docker." && exit 1)

ensure-node:
	@$(NODE22) node -v >/dev/null

check-docker:
	@echo "Checking Docker daemon..."
	@log_file="$$(mktemp -t flathunter-docker-check.XXXXXX)"; \
	docker info >"$$log_file" 2>&1 & \
	pid=$$!; \
	status=""; \
	for _ in 1 2 3 4 5 6 7 8; do \
		if ! kill -0 $$pid >/dev/null 2>&1; then \
			wait $$pid; \
			status=$$?; \
			break; \
		fi; \
		sleep 1; \
	done; \
	if [ -z "$$status" ]; then \
		kill $$pid >/dev/null 2>&1 || true; \
		wait $$pid >/dev/null 2>&1 || true; \
		echo "Docker daemon check timed out."; \
		echo "Docker Desktop may be starting or stuck."; \
		echo "Start or restart Docker Desktop with: open -a Docker"; \
		echo "If Docker is already open, wait for it to finish booting and retry."; \
		rm -f "$$log_file"; \
		exit 1; \
	fi; \
	if [ "$$status" -ne 0 ]; then \
		echo "Docker daemon is not running."; \
		echo "Start Docker Desktop with: open -a Docker"; \
		echo "Then wait until Docker finishes booting and run 'make dev' again."; \
		tail -n 20 "$$log_file"; \
		rm -f "$$log_file"; \
		exit 1; \
	fi; \
	rm -f "$$log_file"

ensure-pnpm: ensure-node
	@$(NODE22) bash -lc 'command -v $(PNPM) >/dev/null 2>&1 || (echo "pnpm not found, installing pnpm@$(PNPM_VERSION) in $$HOME/.local..." && npm install -g pnpm@$(PNPM_VERSION) --prefix "$$HOME/.local")'

install: ensure-pnpm
	$(NODE22) $(PNPM) install

infra-up: check-docker
	$(COMPOSE) up -d

infra-down:
	$(COMPOSE) down

infra-logs:
	$(COMPOSE) logs -f

oracle-config: oracle-check-env
	$(ORACLE_COMPOSE) config

oracle-up: oracle-check-env check-docker
	$(ORACLE_COMPOSE) up -d --build

oracle-down: oracle-check-env
	$(ORACLE_COMPOSE) down

oracle-logs: oracle-check-env
	$(ORACLE_COMPOSE) logs -f

prod-config: prod-check-env prod-check-scheme
	$(PROD_COMPOSE) config

prod-build: prod-check-env prod-check-scheme prod-check-docker
	$(PROD_COMPOSE) build --pull

prod-deploy: prod-check-env prod-check-scheme prod-check-branch prod-check-docker
	git pull --ff-only origin $(PROD_BRANCH)
	$(PROD_COMPOSE) config >/dev/null
	$(PROD_COMPOSE) build --pull
	$(PROD_COMPOSE) up -d postgres
	$(PROD_COMPOSE) run --rm migrate
	$(PROD_COMPOSE) up -d --remove-orphans api worker web-$(PROD_SCHEME)
	@echo "FlatHunter production: $(PROD_APP_ORIGIN)"

prod-stop: prod-check-env
	$(PROD_COMPOSE_ALL) down --remove-orphans

prod-logs: prod-check-env
	$(PROD_COMPOSE_ALL) logs -f

deploy-prod: prod-deploy

stop-prod: prod-stop

migrate: check-env ensure-pnpm
	$(NODE22) $(PNPM) db:migrate

dev: check-env install infra-up migrate
	@echo "FlatHunter web: http://localhost:3000"
	@echo "FlatHunter api: http://localhost:4000"
	$(NODE22) $(PNPM) dev

start: dev

worker: check-env install infra-up migrate
	$(NODE22) $(PNPM) worker:run

worker-dev: check-env install infra-up migrate
	$(NODE22) $(PNPM) worker:dev

build: ensure-pnpm
	$(NODE22) $(PNPM) build

test: ensure-pnpm
	$(NODE22) $(PNPM) test

typecheck: ensure-pnpm
	$(NODE22) $(PNPM) typecheck

clean:
	rm -rf apps/web/dist apps/api/dist apps/worker/dist
