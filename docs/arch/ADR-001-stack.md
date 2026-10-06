# ADR-001. Стек и версии

- Дата: 06.10.2026. Статус: принято (WP-00). Основа: ARCHITECTURE 0, 1.1, 1.4.

## Контекст

- Нужна основа для 4 приложений (сайт, админка, бот, фоновые задачи) и 11 пакетов, которую параллельно развивают 5–6 агентов.
- Сравнивались варианты «Лёгкий» (Next без CMS, Drizzle, чистый `domain`) и «Payload» (Payload 3 как админка).

## Решение

- Основа — «Лёгкий» с пересадками из «Payload» (ARCHITECTURE 0).
- Версии закреплены точно в `catalog:` файла `pnpm-workspace.yaml`; агент пакета не поднимает версию сам.
- Ключевые версии: Node 24.21.0, pnpm 12.9.1, TypeScript 6.0.3, Next 16.3.8, React 19.3.0, next-intl 4.14.9, Drizzle 0.45.3 / drizzle-kit 0.31.11, pg 8.23.1, PostgreSQL 18.6 (`postgres:18.6-trixie`), pg-boss 12.36.0, grammY 1.46.0, zod 4.6.5, vitest 5.0.3, Playwright 1.63.0, Biome 2.5.15.
- Не используются: payload, turbo, prisma, Redis/bullmq, `@grammyjs/conversations`, typescript-eslint, testcontainers.

## Проверено в WP-00

- Все версии каталога установлены `pnpm install --frozen-lockfile` под политикой `minimumReleaseAge: 4320`.
- `next build` web и admin (Turbopack, `output: "standalone"`) проходит; `tsc -b` по пакетам и `tsc --noEmit` по приложениям — без ошибок.
- PostgreSQL 18.6: `DEFAULT uuidv7()` работает (интеграционный тест `packages/db/src/migrations.int.test.ts`).

## Отклонения от документа

- Нет. Сборка `next build` идёт через Turbopack (по умолчанию в Next 16); `turbopack.root` и `outputFileTracingRoot` указывают на корень монорепозитория.
- Next 16.3 по умолчанию пишет `AGENTS.md`/`CLAUDE.md` в папку приложения при `next dev`; выключено (`agentRules: false`), правила агентов — в корневом `CLAUDE.md`.

## Последствия

- Обновления мажорных версий (Drizzle 1.0, React 19.4, TypeScript 7, Node 26) — отдельными пакетами работ.
- Исправления безопасности Next — за 48 ч (исключение `next` из `minimumReleaseAge`).
