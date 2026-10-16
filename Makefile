.PHONY: help install up down dev migrate seed demo db-reset test lint typecheck build format

help:
	@echo "make dev        - start Mongo+Redis (docker), migrate, seed, run web+api+realtime locally"
	@echo "make up/down    - start/stop Mongo+Redis containers"
	@echo "make migrate    - create MongoDB indexes"
	@echo "make seed       - seed two demo tenants"
	@echo "make demo       - add the demo workspace content (people, groups, spaces)"
	@echo "make db-reset   - wipe DB volume, then migrate and seed"
	@echo "make test lint typecheck build format"


install:
	pnpm install

up:
	docker compose up -d --wait mongo redis

down:
	docker compose down

migrate: install
	pnpm db:migrate

seed: install
	pnpm db:seed

demo: seed
	pnpm db:seed:demo

dev: install up migrate demo
	pnpm dev

db-reset: install
	docker compose down -v
	docker compose up -d --wait mongo redis
	pnpm db:migrate
	pnpm db:seed
	pnpm db:seed:demo

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
