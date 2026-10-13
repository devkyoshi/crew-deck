.PHONY: help install up down dev migrate rollback seed db-reset test lint typecheck build format

help:
	@echo "make dev        - start Postgres+Redis (docker), migrate, seed, run web+api locally"
	@echo "make up/down    - start/stop Postgres+Redis containers"
	@echo "make migrate    - apply SQL migrations (rollback: make rollback)"
	@echo "make seed       - seed two demo tenants"
	@echo "make db-reset   - wipe DB volume, then migrate and seed"
	@echo "make test lint typecheck build format"


install:
	pnpm install

up:
	docker compose up -d --wait postgres redis

down:
	docker compose down

migrate: install
	pnpm db:migrate

rollback: install
	pnpm --filter @crew-deck/api db:rollback

seed: install
	pnpm db:seed

dev: install up migrate seed
	pnpm dev

db-reset:
	docker compose down -v
	$(MAKE) up migrate seed

test: install
	pnpm test

lint: install
	pnpm lint

typecheck: install
	pnpm typecheck

build: install
	pnpm build

format: install
	pnpm format
