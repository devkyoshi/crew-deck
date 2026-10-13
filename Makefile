.PHONY: help install up down dev migrate rollback seed db-reset test lint typecheck build format

help:
	@echo "make dev        - start Postgres+Redis (docker), migrate, seed, run web+api locally"
	@echo "make up/down    - start/stop Postgres+Redis containers"
	@echo "make migrate    - apply SQL migrations (rollback: make rollback)"
	@echo "make seed       - seed two demo tenants"
	@echo "make db-reset   - wipe DB volume, then migrate and seed"
	@echo "make test lint typecheck build format"

node_modules: package.json pnpm-lock.yaml
	pnpm install
	@touch node_modules

install: node_modules

up:
	docker compose up -d --wait postgres redis

down:
	docker compose down

migrate: node_modules
	pnpm db:migrate

rollback: node_modules
	pnpm --filter @crew-deck/api db:rollback

seed: node_modules
	pnpm db:seed

dev: node_modules up migrate seed
	pnpm dev

db-reset:
	docker compose down -v
	$(MAKE) up migrate seed

test: node_modules
	pnpm test

lint: node_modules
	pnpm lint

typecheck: node_modules
	pnpm typecheck

build: node_modules
	pnpm build

format: node_modules
	pnpm format
