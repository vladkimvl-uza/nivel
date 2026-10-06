# Архитектура платформы Nivel

Дата: 05.10.2026. Автор: главный архитектор (Claude Code). Статус: итоговая архитектура для разработки; план работ — [BUILD_PLAN.md](BUILD_PLAN.md).

- Основа: BRIEF, CONCEPT, DECISIONS (Р-1 – Р-27), блоки 02b, 04, 05, 08, 15, 16, 17, 18, 20, 26, 28; живые макеты `docs/design/mockups/{b-pasport,a-masterskaya,v-noch}`; два варианта архитекторов («Payload» и «Лёгкий») и два вердикта судей.
- Пометки: «факт» — проверено 05.10.2026 (`npm view`, changelog пакета, Docker Hub); «решение» — выбор архитектора; «проверить» — подтверждается спайком в пакете работ.
- Код, имена и комментарии — по-английски; тексты интерфейса — uz и ru; этот документ — деловой русский.
- Документ не заменяет юриста: всё, что зависит от оферты и ответа Налогового комитета, вынесено в настройки и помечено.

## Коротко

1. Основа — вариант «Лёгкий»: Next.js 16 без CMS, своя админка, Drizzle и чистый пакет `domain`. Из варианта «Payload» пересажены типы денег, 28 правил совместимости, автомат заказа с двумя флагами оплаты, слой сценариев с транзакционным outbox, сопоставление прайсов, смена темы без выпуска, проверка владения файлами и тесты без сети.
2. Монорепозиторий pnpm 12.9.1 без Turborepo: 4 приложения (`web`, `admin`, `bot`, `worker`) и 11 пакетов. Node 24.21.0 LTS скачивает и запускает сам pnpm (`devEngines.runtime`); глобальный Node 25.9 на машине не трогаем.
3. Стек: Next 16.3.8, React 19.3.0, TypeScript 6.0.3, Drizzle 0.45.3 + pg 8.23.1, PostgreSQL 18.6, pg-boss 12.36.0, grammY 1.46.0, zod 4.6.5, next-intl 4.14.9, Tailwind 4.3.3, `@anthropic-ai/sdk` 0.131.0, `@react-pdf/renderer` 4.9.0, vitest 5.0.3, Playwright 1.63.0.
4. Деньги — целые сумы (`Sum`) и базисные пункты (`Bp`) с брендированными типами. Плата округляется вниз до сума: ставка никогда не выходит за шкалу. Два потока денег защищены дважды: в `domain` и в базе (CHECK, триггеры, журналы только на дописывание).
5. Заказ меняет статус только через `services.orders.dispatch(orderId, event, actor)`: одна транзакция пишет статус, журнал и outbox. Смету можно отправить при оферте-заглушке (с водяным знаком), принять и платить — только при опубликованной узбекской оферте (Р-25).
6. Админка — отдельное приложение за WireGuard, вход паролем и TOTP. Типовые экраны строятся набором `admin kit` из zod-схем; R0 — заказы, платежи, закупки с фото чеков, ручные цены и CSV, PDF, настройки денег, журнал, каталог импортом CSV и одной общей формой.
7. Сайт — uz первым, ru вторым; тема дизайна (Б, А или В) — атрибут `data-theme` из настроек, владелец переключает её без выпуска кода. Компоненты используют только семантические токены.
8. Бот — тот же `domain` и те же переводы ICU; заявка — тема в закрытой группе владельца. ИИ-консультант выключен без ключа и флага; модель видит только каталог и результаты инструментов.
9. Прод — один VPS 2/4 в Ташкенте, Docker Compose с лимитами памяти (≈ 2,9 ГБ); копии — restic в РУз и в ЕС (B2), зашифрованная копия `.env`, еженедельная проверка восстановления.
10. План — 27 пакетов работ (WP-00 – WP-26); R0 (бот, одностраничный сайт, лёгкая админка, PDF, деплой и копии) — к 02.11.2026; MVP-1 — к 15.01.2027.

## 0. Выбор основы

Судьи разошлись: «Лёгкий» 7,5 против 6,5 и «Payload» 7,5 против 7,0. Решение архитектора — основа «Лёгкий», с обязательными пересадками из «Payload».

| Довод | Вывод |
| --- | --- |
| Критический путь R0 (02.11) — экраны заказа: доска, смета, платежи, закупки с чеками, отчёт комиссионера, порог. В обоих вариантах они пишутся с нуля (в Payload — своими экранами через import map) | Готовая админка Payload экономит время на каталоге и контенте, то есть в R1, а не на сроке R0 |
| Факт: `@payloadcms/db-postgres` 3.90.2 закрепляет `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.7, `pg` 8.20.0; `@payloadcms/next` требует `next >=16.3.3 <17`; Payload 4 — canary | Overrides, вынужденный переход на Payload 4, обновления Next зависят от Payload. В «Лёгком» одна копия Drizzle и один `pg` с pg-boss |
| Безопасность: в Payload нет второго фактора, админка и `/cms-api` живут в процессе публичного сайта | Отдельное приложение `admin` на `admin.nivel.uz` за WireGuard, пароль и TOTP, своя роль БД |
| Предсказуемость для агентов: обычный Next, Drizzle, zod; без неявных хуков, общего `payload-types.ts` и `getPayload()` в боте и воркере | Меньше конфликтов параллельных веток, проще тесты (база на воркер vitest без инициализации CMS) |
| Красные линии денег в базе (CHECK, триггеры) естественны при своей схеме; поверх таблиц, которые генерирует Payload, они хрупкие | Вторая линия защиты денег — с первого дня |
| Слабость «Лёгкого» — объём своей админки (оценка архитектора 40–60 ч, блок 17 — 3–6 недель) | Снимается: набор `admin kit` в WP-10 до экранов R0; каталог в R0 — импорт CSV и одна общая форма; полные экраны каталога и правил — R1; роль переводчика и поток XLSX для переводов |
| CONCEPT 6.1 и 5.11 называют Payload | Это выбор блока 17, а не решение владельца; отступление оформляется ADR-002 в WP-00 и правкой CONCEPT 6.1 после утверждения |

Пересажено из «Payload» (раздел указан в скобках): брендированные `Sum`/`Bp`, `applyBp`, `splitByShares` и свойства fast-check (4.2); 28 правил ПК, 9 правил сетапа, вердикт `incomplete` и `missingData`, ключи сообщений (4.4); автомат с `accepted` и двумя флагами, `purchaseNotBefore`, ручная отметка перед отправкой сметы, `REPORT_DEEMED_ACCEPTED`, гарантия отдельным автоматом, запрет денежных событий для помощника (4.9); `feeToInvoice` при отказе (4.7); слой сценариев и транзакционный outbox (4.13); `sku_mappings` и поля продавца (3.3); тема во время работы (5.7); `check-ownership` (2.3); проверка запуска в бою (10.1); MSW и `NETWORK_GUARD` (11.3); `age`-копия `.env`, оповещение по `getWebhookInfo`, бюджет JS по маршрутам (12).

## 1. Стек и версии

### 1.1. Версии на 05.10.2026

Факт: `npm view <пакет> version` 05.10.2026. Версии фиксируются точно (без `^`) в каталоге pnpm (`pnpm-workspace.yaml`, раздел `catalog`); агент пакета не может поднять версию сам.

| Слой | Пакет | Версия | Замечания |
| --- | --- | --- | --- |
| Рантайм | Node.js | 24.21.0 LTS | Docker, CI, прод и скрипты pnpm на машине разработки |
| Пакетный менеджер | pnpm | 12.9.1 | Нативный исполняемый файл; обоснование — 1.3 |
| Язык | typescript | 6.0.3 | Факт: в 7.0.2 нет классического JS API (экспорт только `./lib/version.cjs` и `./unstable/*`); проверка типов `next build` использует JS API |
| Линтер и форматтер | @biomejs/biome | 2.5.15 | Вместо ESLint и Prettier |
| Сайт и админка | next | 16.3.8 | `output: "standalone"`; в Next 16 `middleware.ts` → `proxy.ts` (проверить в WP-00) |
| UI | react, react-dom, @types/react | 19.3.0 | Факт: R3F 9.8.1 требует `react <19.4` — каталог держит 19.3.x |
| i18n | next-intl, use-intl | 4.14.9 | `use-intl` (`createTranslator`) — в боте и PDF |
| Стили | tailwindcss, @tailwindcss/postcss | 4.3.3 | Классы ссылаются только на семантические токены |
| ORM | drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 | 1.0 — RC, не брать |
| Драйвер | pg | 8.23.1 | Один на проект, общий с pg-boss |
| База | PostgreSQL, образ `postgres:18.6-trixie` | 18.6 | 19 — бета. Используем `uuidv7()` из ядра 18 |
| Очередь | pg-boss | 12.36.0 | Факт: `engines` Node ≥ 22.12 |
| Валидация | zod | 4.6.5 | Совместим с peer SDK Anthropic |
| Бот | grammy | 1.46.0 | Bot API 10.3 |
| Бот, плагины | @grammyjs/runner / @grammyjs/auto-retry | 2.0.3 / 2.0.2 | `conversations` и `menu` не берём: шаги — своим автоматом в сессии |
| Mini App (V1) | @tma.js/sdk-react | 3.0.23 | Только клиент; подпись `initData` — своя на `node:crypto` |
| Токены Mini App | jose | 6.2.12 | Короткий токен в памяти страницы |
| ИИ | @anthropic-ai/sdk | 0.131.0 | Messages API, свой цикл инструментов |
| PDF | @react-pdf/renderer | 4.9.0 | Без Chromium: −300–500 МБ памяти на VPS |
| QR в PDF | qrcode | 1.5.4 | Ссылки на `/s/{код}` и паспорт сборки |
| Импорт | csv-parse / exceljs | 7.0.3 / 4.4.0 | CSV — прайсы; XLSX — выгрузка переводов (и прайсов в R1) |
| Изображения | sharp | 0.35.5 | Снятие EXIF и геометки с фото чеков; AVIF и WebP |
| Пароли, второй фактор | @node-rs/argon2 / @oslojs/otp | 2.2.1 / 1.1.0 | Готовые бинарники win32-x64 и linux-x64 |
| Коды | nanoid | 6.0.1 | 8 знаков base32 без похожих букв |
| Ограничение частоты | rate-limiter-flexible | 11.2.1 | Хранилище — Postgres |
| Логи | pino | 10.4.0 | `redact` для ПД |
| Анимация (R2) | gsap / lenis | 3.15.0 / 1.3.26 | Только главная, динамический импорт; Lenis — только `pointer: fine` |
| 3D (версия 2) | three / @react-three/fiber / @react-three/drei | 0.186.1 / 9.8.1 / 10.7.9 | В R0–R2 не подключаются |
| Тесты | vitest, @vitest/coverage-v8 | 5.0.3 | Факт: `engines` `^22.12 ‖ ^24 ‖ >=26` |
| Свойства | fast-check | 4.10.2 | Формулы денег |
| Моки HTTP | msw | 3.0.2 | ЦБ, Bot API, Anthropic, Instagram без сети |
| e2e | @playwright/test | 1.63.0 | Chromium, профили Pixel 7 и iPhone 13 |
| Типы Node | @types/node | 24.19.1 | Под рабочую линию 24 |
| Прокси | `caddy:2.11.6-alpine` | 2.11.6 | Автоматический TLS |
| Аналитика | Umami | v3.4.0 | Без cookie, своя БД в том же Postgres, профиль `analytics` |
| Копии | restic | 0.19.1 | Шифрование, дедупликация; WAL-G 3.0.9 — по триггеру (12.4) |

Не используются сознательно: payload, turbo, prisma, Redis и bullmq, @grammyjs/conversations, typescript-eslint, testcontainers, облачный Sentry, GlitchTip (до сервера 8 ГБ).

### 1.2. Node на Windows

- Факт: Node 25 — нечётная ветка без LTS; `engines` vitest 5.0.3 её исключают.
- Факт (changelog pnpm 12.9.1): pnpm сам скачивает Node, закреплённый в `devEngines.runtime` с `onFail: "download"`, запускает им все скрипты и подставляет `node` внутри проекта через свои шимы без хуков оболочки, в том числе на Windows. Это снимает проблему fnm в неинтерактивных оболочках агентов (PowerShell, Git Bash).
- Решение:
  - корневой `package.json`: `"devEngines": { "runtime": { "name": "node", "version": "24.21.0", "onFail": "download" }, "packageManager": { "name": "pnpm", "version": "12.9.1", "onFail": "download" } }`;
  - `engines.node: ">=24.21"` без `engine-strict`: установка на 25.9 не падает, только предупреждает;
  - `tools/check-node.mjs` в `pnpm ci:local` требует мажорную версию 24 — CI и проверка интегратора идут только на 24;
  - `.node-version` = `24.21.0` для редакторов и запасного пути `fnm exec --using=.node-version`;
  - проверить в WP-00: `pnpm exec node -v` → `v24.21.0` из PowerShell и Git Bash.
- Переход на Node 26 (LTS с 28.10.2026) — отдельный пакет работ в I квартале 2027.

### 1.3. pnpm, а не npm workspaces

- Каталог версий (`catalog:`): одна версия React, Next, zod, Drizzle на весь репозиторий. При 4–5 параллельных агентах это главный способ не получить два React или две копии Drizzle.
- Строгий `node_modules`: пакет не импортирует то, чего нет в его `package.json`; скрытые зависимости ловятся сразу.
- Управление Node (`devEngines.runtime`) — решение проблемы Node 25 без fnm.
- `pnpm deploy --prod` — папка приложения для Docker только с нужными зависимостями.
- Защита цепочки поставки: `onlyBuiltDependencies` (`sharp`, `@node-rs/argon2`), `minimumReleaseAge: 4320` (3 суток) с исключением `next` (исправления безопасности — за 48 ч).
- `-r` и `--filter` заменяют Turborepo; `tsc -b` — инкрементальная сборка типов.
- Цена: одна команда `npm i -g pnpm@12.9.1`. npm workspaces 11.12 работают без установки, но без каталога версий, строгих зависимостей и управления Node — запасной путь, переход за час (структура папок та же).

### 1.4. Отступления от блока 17 и CONCEPT 6.1

| Было | Стало | Причина |
| --- | --- | --- |
| Payload 3.90 как админка | Своё приложение `admin` | Раздел 0 |
| Turborepo 2.11.7 | `pnpm -r --filter`, `tsc -b`, `tools/check-deps.mjs` | 4 приложения и 11 пакетов собираются за минуты; Turborepo — если CI дольше 10 мин |
| TypeScript 7.0.2 | 6.0.3 | 1.1; переход — когда Next объявит поддержку |
| GlitchTip | Таблица `ops.app_errors` и сводка в Telegram | Память VPS 4 ГБ |
| Fluent `.ftl` (блоки 16, 26) | ICU JSON с файлом метаданных для переводчика | Один формат для сайта, бота и PDF; контекст и лимиты — в `meta` (5.2) |
| Длинный опрос в боте | `BOT_MODE=polling` в R0, `webhook` включается переменной | Вебхук готов без переделки |

## 2. Структура репозитория

### 2.1. Дерево

```text
setup-studio/
  apps/
    web/        Next.js: public site uz/ru, configurators, /s/{code}, /tma, AI chat route, internal revalidate API
    admin/      Next.js: owner admin (RU UI), server actions, admin kit; reachable only via WireGuard
    bot/        grammY: client bot + owner forum group; polling or webhook
    worker/     pg-boss: CBU rates, price imports, medians, reminders, PDF, outbox relay, threshold, retention
  packages/
    domain/     PURE TS, zero runtime deps: money, fee, quote, cancel, threshold, compat, market, autobuild, order FSM, warranty FSM, calendar, uz text
    contracts/  zod schemas: DTOs, action inputs, product specs per category, settings, CSV/XLSX row schemas
    db/         Drizzle schema (pgSchema per module), SQL migrations, repositories, demo seed (is_demo)
    services/   use cases on top of db + domain: orders.dispatch, leads, quotes, payments, purchases, reports, configs; outbox writes
    i18n/       ICU messages uz/ru per namespace + meta (context, max length), formatters (sum, date), uz normalization re-export
    ui/         semantic tokens, theme files b/a/v from mockups, fonts (OFL woff2/ttf), React primitives, badges (demo, draft, visualization)
    pdf/        @react-pdf templates: quote, commission report, acts, build passport, warranty card
    ai/         Anthropic client, tools adapter, PII scrubber, output guards, budget, recorded evals
    telegram/   initData verification, Bot API helpers, message templates, callback_data codec
    config/     env schema (zod) per app, tsconfig base, biome config
    testing/    DB harness, fixtures per WP, golden builds, MSW handlers, network guard
  infra/
    compose.dev.yml  compose.test.yml  compose.prod.yml  Caddyfile  docker/app.Dockerfile
    backup/ (restic, pg_dump, restore-check)  wireguard/ (templates, no keys)  RUNBOOK-*.md
  tools/        check-*.mjs (deps, ownership, antilist, uz-text, messages, node, ports, bundle-budget, demo), i18n-export/import, git-bundle.ps1, check_names.py (exists)
  docs/         existing docs + docs/arch/ (ADR-*.md, OWNERSHIP.md, DATA-MAP.md)
```

### 2.2. Граф зависимостей

- `domain` — ни от чего. От него зависят все.
- `contracts` → `domain` (типы), `zod`.
- `db` → `contracts`, `domain`; `drizzle-orm`, `pg`.
- `services` → `db`, `domain`, `contracts`.
- `i18n` → `domain` (нормализация узбекского), `use-intl`.
- `pdf` → `domain`, `i18n`, `contracts`, `ui` (только шрифты и токены документа).
- `ai` → `domain`, `contracts`, `services` (только чтение и черновики), SDK.
- `telegram` → `contracts`, `i18n`.
- `ui` → React; `config` и `testing` — инфраструктурные.
- Приложения импортируют пакеты, но не друг друга. Связь приложений — только БД, outbox и pg-boss, внутренний HTTP с HMAC (инвалидация кэша сайта).
- `tools/check-deps.mjs` в CI разбирает `package.json` всех пакетов и запрещает обратные рёбра и импорт приложения из приложения.

### 2.3. Параллельная работа агентов

- Владение: каждый пакет работ (BUILD_PLAN) владеет списком глобов в `docs/arch/OWNERSHIP.md`. `tools/check-ownership.mjs` сравнивает `git diff --name-only main...HEAD` с глобами ветки; чужой файл — ошибка. Исключения: свои файлы в `packages/testing/fixtures/<wp>/` и свои пространства имён `packages/i18n/messages/{uz,ru,meta}/<ns>.json`.
- Ветки: `git worktree` на пакет (`C:\Users\v.kim\setup-studio-wt\wp-NN`), ветка `wp/NN-<имя>`. В `main` пишет только интегратор, сливает по одной ветке после `pnpm ci:local`.
- Только у интегратора: корневой `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/db/migrations/**`, `packages/db/src/schema/index.ts`. Агенту нужна зависимость или колонка — заявка в описании ветки; интегратор вносит её. Lock-файл руками не сливается: после rebase — `pnpm install`.
- Миграции: агенты правят только свой файл схемы `packages/db/src/schema/<module>.ts` и свой SQL в `packages/db/sql/<module>/*.sql`; `drizzle-kit generate` (префикс `timestamp`) запускает интегратор после слияния.
- Контракты первыми: интерфейсы раздела 4 копируются в `packages/domain/src/**/types.ts` в WP-00 и замораживаются. Изменение — малый PR с меткой `contract` и ADR, затем перебазирование потребителей.
- Маршруты — по папкам: агент сайта владеет `apps/web/app/[locale]/(marketing)`, конфигуратора — `(configurator)`, ИИ — `app/api/ai/**`; в админке — папки разделов `apps/admin/app/(section)/**`.
- Фича-флаги в `ops.settings` (`feature.ai`, `feature.setupConfigurator`, `feature.scene`, `feature.miniApp`): незаконченная работа сливается выключенной.
- Порты и базы worktree: переменная `NIVEL_SLOT` (0 — основная папка, 1–9 — worktree) задаёт `PORT_BASE = 3100 + 100 × slot` (web `+0`, admin `+1`, worker `+2`, bot `+3`) и префикс тестовых баз `nivel_s<slot>_…_test`. `tools/check-ports.mjs` проверяет, что порты свободны, до `pnpm dev`.

## 3. Модель данных

### 3.1. Принципы

- PostgreSQL 18.6, схемы `catalog`, `pricing`, `sales`, `content`, `ai`, `bot`, `ops`; pg-boss — схема `pgboss`; Umami — отдельная БД.
- Деньги — `bigint` целых сум. В TS — `Sum` (брендированный `number` с проверкой `Number.isSafeInteger`; суммы до 9·10¹⁵ безопасны). Ставки — `integer` базисных пунктов (`1500` = 15 %).
- Долларовые цены продавцов — `numeric(14,2)` плюс ссылка на курс ЦБ; клиенту — только сумы. Курс — `numeric(14,4)`, разбор строки без плавающей точки.
- Время — `timestamptz` (UTC); бизнес-календарь — `Asia/Tashkent` (UTC+5), рабочие дни пн–сб, праздники — в `ops.settings`.
- Локализуемые поля — `jsonb` `{ "uz": "...", "ru": "..." }` (zod-тип `Localized`); для публикации обязателен `uz` (Р-25). Бренды, модели, артикулы и характеристики не переводятся.
- Идентификаторы — `uuid DEFAULT uuidv7()`. Публичные номера: заявка `L-2026-0001`, заказ `NV-2026-0001`, гарантийный случай `G-2026-0001`; код сохранённой сборки — 8 знаков base32.
- Только дописывание (триггер запрещает `UPDATE` и `DELETE`; исправление — записью-сторно): `ops.audit_log`, `sales.order_events`, `pricing.price_observations` (кроме флага `excluded` с причиной), `sales.payments` (кроме перехода статуса `expected → confirmed | void`), `ops.consents`, `sales.reserve_ledger`, `ai.messages`.
- Демо-данные: `is_demo boolean` в каталоге, ценах, шаблонах, «Идеях»; сид отказывается работать при `APP_MODE=production`; на сайте и в боте у демо — плашка «Демо-данные, не цена».
- Схема меняется только миграциями (`drizzle-kit generate` + SQL-файлы для триггеров, ролей и представлений); `push` не используется.

### 3.2. Роли БД

| Роль | Права |
| --- | --- |
| `nivel_migrator` | DDL; только одноразовый контейнер `migrate` и локальная команда `pnpm db:migrate` |
| `nivel_web` | Чтение каталога, цен, контента, настроек; запись `configurations`, `leads`, `customers` (создание), `ops.consents`, `ai.*`, `ops.outbox`; платежи и закупки — только через представления `sales.v_customer_order_*` |
| `nivel_admin` | Всё в схемах приложения, кроме `pgboss`; DDL нет |
| `nivel_bot` | Заявки, клиенты, сессии, согласия, чтение заказов клиента, вызов сценариев заказа от имени клиента и владельца в группе |
| `nivel_worker` | Цены, курсы, задачи, файлы, outbox, напоминания, `pgboss` |

Каждое приложение получает свой `DATABASE_URL_<APP>`; тестовая настройка переопределяет все сразу (11.3).

### 3.3. Таблицы

#### catalog

| Таблица | Ключевые поля | Индексы и ограничения |
| --- | --- | --- |
| `categories` | `code` (cpu, mb, ram, ssd, gpu, psu, case, cooler_air, aio, fan, monitor, arm, desk, desk_frame, desk_top, chair, keyboard, mouse, mousepad, headset, microphone, webcam, light, speakers, acoustic_panel, cable_mgmt, ups, decor, os_license), `group` (pc/setup/service), `name` (Localized), `fee_group_default` (pc/mount/outside_scale), `freshness_days` (7/3/30), `returnable_default`, `sort` | `unique(code)` |
| `products` | `id`, `slug`, `category_code`, `brand`, `model`, `mpn`, `ean`, `price_class_id`, `ladder_step`, `color_body` (black/white/gray/other), `lighting` (none/rgb/argb), `noise_dba`, `power_peak_w`, `power_typical_w`, `mfr_warranty_months`, `official_import` (yes/no/unknown), `mfr_url`, `mfr_checked_at`, `status` (draft/verified/retired), `specs` jsonb (4.3), `dims_mm` jsonb, `fee_group` (переопределение), `returnable`, `manual_only`, `image_file_id`, `description` (Localized), `created_by`, `verified_by`, `is_demo` | `unique(brand, mpn)`; `(category_code, status)`; GIN `specs jsonb_path_ops`; GIN trigram по `brand ‖ model ‖ mpn`; `STORED`-колонки `spec_socket`, `spec_ram_type`, `spec_form_factor` с B-tree; CHECK: `verified` только при полных полях правил «нельзя» (проверка — в сервисе, в базе — `NOT NULL` нужных ключей через функцию) |
| `price_classes` | `id`, `category_code`, `key` (`gpu.rtx5070`), `name` (Localized: «RTX 5070 12 ГБ, базовое исполнение»), `ladder_code`, `step`, `perf_class` (Localized, «оценка»), `manual_only` | `unique(key)`; `(ladder_code, step)` |
| `ladders` | `code` (gpu, cpu_am5, cpu_lga1700, ram, ssd), `steps` (упорядоченные `price_class_id`) | `unique(code)` |
| `analogs` | `product_id`, `analog_product_id` | PK пары |
| `perf_facts` | `price_class_id`, `task`, `metric`, `value`, `conditions`, `source`, `url`, `fetched_at`, `entered_by`; без источника не публикуется | `(price_class_id, task)` |
| `rule_sets` | `version`, `status` (draft/published), `payload` jsonb (`RuleSet`, пороги `CompatSettings`, `SelectionSettings`), `golden_run` jsonb, `published_at`, `published_by` | `unique(version)`; одна `published` |
| `base_builds` | `id`, `task` (gaming/streaming/design3d/programming/office), `tier` (T1–T4), `style` (A/B), `variant` (`base` или `plus` для «Офис Т1+»), `status` (offered/not_offered), `redirect_task`, `explain` (Localized), `is_showcase`, `is_demo` | `unique(task, tier, style, variant)` |
| `base_build_items` | `base_build_id`, `slot`, `price_class_id` или `product_id`, `qty`, `role` | `(base_build_id)` |

#### pricing

| Таблица | Ключевые поля | Индексы |
| --- | --- | --- |
| `vendors` | `id`, `name`, `kind` (partner/shop/marketplace_seller/private), `site`, `public_name_allowed`, `price_source` (partner_sheet/csv/telegram/manual/scrape_allowed), `sheet_csv_url`, `terms_checked_at`, `issues_fiscal_receipt`, `esf_available`, `accepts_corp_card`, `return_days` (Mycom 10, SitWell 3), `assembly_keeps_warranty`, `accepts_claims_from_ip`, `agreement_file_id`, `contact` (рабочий), `status`, `is_demo` | `unique(name)` |
| `offers` | `id`, `vendor_id`, `product_id` (null до сопоставления), `vendor_sku`, `raw_title`, `mpn`, `ean`, `url`, `condition` (new/refurb/used), `match_status` (auto/manual/unmatched/rejected), `matched_by`, `active` | `unique(vendor_id, vendor_sku)`; `(product_id)` |
| `sku_mappings` | `vendor_id`, `vendor_sku`, `raw_title_normalized`, `product_id`, `confirmed_by`, `confirmed_at` — память сопоставления «строка прайса → позиция» | `unique(vendor_id, vendor_sku)`; trigram по `raw_title_normalized` |
| `price_imports` | `id`, `vendor_id`, `format` (csv/gsheet_csv/xlsx/tg_post/manual), `file_id` или `url`, `status` (pending/preview/applied/failed), `rows_total`, `rows_matched`, `rows_unmatched`, `rows_error`, `errors` jsonb, `actor`, `started_at`, `applied_at` | `(vendor_id, started_at desc)` |
| `price_observations` | `id`, `offer_id`, `product_id`, `vendor_id`, `price_sum`, `orig_amount`, `orig_currency` (UZS/USD), `fx_rate_id`, `availability` (in_stock/on_order/preorder/ask), `condition`, `is_from_price`, `vendor_warranty_months`, `observed_at`, `source` (partner_csv/partner_gsheet/partner_tg/manual/scrape), `import_id`, `entered_by`, `excluded`, `exclude_reason` (outlier/currency_error/stale/not_in_stock/from_price/private_seller/duplicate_vendor/manual), `is_demo` | `(product_id, observed_at desc)`; `(offer_id, observed_at desc)`; `(import_id)` |
| `market_prices` | `product_id`, `as_of` (date), `median_sum`, `from_sum`, `min_sum`, `max_sum`, `offers_n`, `vendors_n`, `max_age_days`, `confidence` (high/medium/low), `flags` text[], `input_ids` uuid[], `computed_at`, `is_demo` | `unique(product_id, as_of)`; представление `v_market_price_current` |
| `fx_rates` | `id`, `ccy` (USD/EUR/RUB), `rate` numeric(14,4), `nominal`, `effective_date`, `fetched_at`, `source` (cbu_json/cbu_xml/manual), `diff` | `unique(ccy, effective_date)` |

#### sales

| Таблица | Ключевые поля | Индексы и связи |
| --- | --- | --- |
| `customers` | `id`, `display_name`, `phone_e164`, `telegram_user_id`, `telegram_username`, `lang`, `district`, `address` (только для доставки, роль owner), `age_18_confirmed`, `created_at`, `erased_at` | частичные `unique(telegram_user_id)`, `unique(phone_e164)` |
| `customer_secrets` | `customer_id`, `kind` (passport_for_poa), `ciphertext`, `iv`, `key_version` — AES-256-GCM, только для запасной схемы «поручение» | PK `(customer_id, kind)` |
| `configurations` | `id`, `public_code`, `kind` (pc/setup), `parent_id`, `items` jsonb (`BuildLine[]`), `room` jsonb, `prefs` jsonb, `engine_version`, `rule_set_version`, `price_snapshot` jsonb (строки, даты, курс), `quote` jsonb, `compat` jsonb, `created_via` (web/tma/bot/ai/admin/idea), `idea_id`, `customer_id`, `created_at`; неизменяема (триггер) | `unique(public_code)`; `(customer_id, created_at)` |
| `leads` | `id`, `number`, `customer_id`, `configuration_id`, `channel`, `utm` jsonb, `lang`, `district`, `wanted_by`, `scope` (pc/pc_periph/setup/podbor), `budget_band`, `comment`, `status` (new/in_review/converted/rejected/spam), `reject_reason` (справочник, журнал Р-26), `tg_topic_id`, `first_response_at`, `created_at` | `(status, created_at)`; `unique(number)` |
| `orders` | `id`, `number`, `lead_id`, `customer_id`, `contract_scheme` (commission по умолчанию / agency; CHECK `<> 'sale'`), `kind` (pc/setup/podbor/upgrade), `slot` (regular/free_window), `complex_build`, `status` (4.9), `fee_prepaid`, `funds_received`, `funds_received_at`, `purchase_not_before`, `first_order_meeting_done`, `current_quote_id`, `offer_version_uz_id`, `offer_version_ru_id`, `accepted_at`, `report_due_at`, `objection_until`, `refund_due_at`, `handed_over_at`, `warranty_until`, `cancel` jsonb (точка, причина, `CancelSettlement`), `podbor_credit_until`, `tg_topic_id`, `assignee` | `(status)`, `(customer_id)`, `unique(number)` |
| `order_events` | `order_id`, `seq`, `at`, `actor_kind`, `actor_id`, `event` jsonb, `from_status`, `to_status`, `guard_snapshot` jsonb | PK `(order_id, seq)`; только дописывание |
| `quotes` | `id`, `order_id`, `version`, `status` (draft/sent/accepted/expired/superseded), `lines` — в `quote_lines`, `totals` jsonb (`QuoteTotals` целиком), `components_sum`, `reserve_bp`, `reserve_sum`, `purchase_limit`, `fee_total`, `fee_commission_line`, `fee_works_line`, `fee_advance`, `fee_final`, `outside_scale_sum`, `fx_rate_id`, `settings_version`, `manually_checked_by`, `manually_checked_at`, `valid_until`, `sent_at`, `accepted_at`, `acceptance` jsonb (канал, хэш IP, id сообщения, версии оферты), `watermark_draft` (оферта-заглушка), `pdf_uz_file_id`, `pdf_ru_file_id`; после `sent` неизменяема | `unique(order_id, version)` |
| `quote_lines` | `id`, `quote_id`, `product_id`, `title_snapshot`, `category_code`, `fee_group`, `qty`, `unit_market_sum` (медиана, целое, без округления вверх), `price_date`, `confidence`, `vendor_hint_id`, `returnable` (yes/no/unknown), `is_ram_or_ssd`, `is_furniture_like`, `customer_owned`, `purchased_by_ip` | `(quote_id)` |
| `payments` | `id`, `order_id`, `kind` (fee_advance/fee_final/fee_extra/podbor_fee/purchase_funds/purchase_topup/remainder_refund/fee_refund/funds_refund), `direction` (in/out), `method` (xolis_qr/merchant_card/bank_transfer_ip/bank_transfer_out), `amount_sum`, `status` (expected/confirmed/void), `fiscal_receipt_no`, `bank_doc_no`, `payer_is_customer`, `third_party_statement_file_id`, `occurred_at`, `confirmed_by`, `confirmed_at`, `reversal_of` | `(order_id, kind)`; CHECK пар 3.4 |
| `purchases` | `id`, `order_id`, `quote_line_id`, `vendor_id`, `product_id`, `qty`, `amount_sum`, `paid_via` (corp_card/bank_transfer), `receipt_kind` (fiscal/esf/none_with_consent), `receipt_no`, `esf_no`, `esf_due` (+10 календарных дней), `esf_status` (pending/signed/rejected), `discount_sum`, `bonus_note`, `serials` text[], `vendor_warranty_months`, `vendor_warranty_until`, `authenticity` jsonb (GPU-Z, SMART, фото коробки), `bought_at`, `bought_by` | `(order_id)`; `(esf_status, esf_due)`; `(vendor_warranty_until)` |
| `purchase_files` | `purchase_id`, `file_id`, `kind` (receipt/box_serial/seal/warranty_card) | PK пары |
| `commission_reports` | `id`, `order_id`, `version`, `received_sum`, `spent_sum`, `discounts_sum`, `remainder_sum`, `lines` jsonb (снимок закупок), `generated_at`, `sent_at`, `due_at`, `objection_until` (+3 рабочих дня), `objection` jsonb, `accepted_at`, `deemed_accepted_at`, `pdf_uz_file_id`, `pdf_ru_file_id` | `unique(order_id, version)` |
| `acts` | `id`, `order_id`, `kind` (material_acceptance/customer_parts/handover), `lines` jsonb, `signed_at`, `signed_via` (tg_button/paper_photo/site_button), `evidence` jsonb, `pdf_*_file_id` | `(order_id, kind)` |
| `build_passports` | `order_id`, `serials` jsonb, `bios_version`, `os` (лицензия по чеку), `tests` jsonb (инструмент, сценарий, минуты, пиковые температуры, ошибки), `photos`, `seal_photos`, `label_code`, `notes`, `pdf_*_file_id` | PK `order_id` |
| `warranty_cases` | `id`, `number`, `order_id`, `purchase_id`, `opened_at`, `channel`, `description`, `due_reply`, `due_diagnosis`, `due_loaner`, `due_fix`, `loaner_item_id`, `vendor_claim` jsonb, `cost_from_reserve_sum`, `client_fault`, `status` (4.10), `closed_at` | `(status)`, `(order_id)` |
| `loaner_items` | `id`, `kind`, `title`, `serial`, `status` (available/issued/repair), `owner_cost_sum` | — |
| `reserve_ledger` | `id`, `fund` (warranty/tax_risk), `order_id`, `amount_sum` (±), `reason`, `at` | `(fund, at)`; только дописывание |
| `other_income` | `id`, `year`, `period`, `amount_sum`, `kind` (other_ip_activity), `note`, `entered_by` — доход другой деятельности ИП для порога (Р-5: деятельность самозанятого переходит в ИП и входит в порог) | `(year)` |

#### content

| Таблица | Ключевые поля |
| --- | --- |
| `pages` | `slug`, `kind` (service/how/prices/faq/warranty), `title` (Localized), `body` (Localized markdown без сырого HTML), `status` (draft/published), `noindex`, `published_at` |
| `policy_texts` | `topic` (payment, fee, warranty, returns, timelines, delivery, glossary, privacy_short, response_hours), `body` (Localized), `version`, `status` (stub/approved) — единственный источник условий для бота, сайта и `get_policy` |
| `legal_documents` | `kind` (offer, privacy, warranty, returns, consent_pd, consent_ai, consent_marketing, consent_photo, stage_tariff, requisites, ai_how_it_works), `version`, `lang`, `body_md`, `status` (stub/lawyer_approved/published), `text_sha256`, `effective_from`; опубликованная версия неизменяема |
| `idea_posts` | `id`, `instagram_url`, `author_handle`, `author_profile_url`, `permission_status` (requested/granted/revoked/none), `permission_file_id`, `permission_at`, `revoked_at`, `takedown_due` (+48 ч), `breakdown` jsonb (Localized «что видно» → `product_id` или `price_class_id`), `pc_configuration_id`, `setup_configuration_id`, `tags`, `oembed_cache` jsonb (только показ), `indexable`, `status`, `is_demo` |
| `portfolio_items` | `kind` (own_build/concept), `order_id`, `publication_consent_id`, `photos`, `caption` (Localized), `label` (concept/visualization) |
| `glossary` | `term_ru`, `term_uz`, `term_uz_new_latin`, `note` (116 терминов блока 26) |
| `hero_scene` | постер AVIF/WebP, видео 720 и 1080, вертикальное 720×1280, 5 кадров с подписями (Localized), `label` = visualization |

#### ai, bot, ops

| Таблица | Ключевые поля |
| --- | --- |
| `ai.conversations` | `id`, `channel`, `lang`, `model`, `mode` (full/economy), `user_ref_hash`, `configuration_id`, `lead_id`, `outcome` (lead/escalated/abandoned/limit), `cost_micro_usd`, `filter_hits`, `started_at`, `purge_after` (+90 дней) |
| `ai.messages` | `conversation_id`, `seq`, `role`, `content` jsonb (ровно то, что ушло в API, после очистки ПД), `shown_text`, `display_substitution`, `request_id`, `usage` jsonb, `latency_ms`, `stop_reason`, `tool_calls` jsonb, `guard_events` jsonb |
| `ai.usage_daily` | `day`, `model`, `cost_micro_usd`, `conversations`, `tokens` jsonb (хранить 12 месяцев) |
| `bot.sessions` | `key`, `value` jsonb (шаг, язык, черновик), `updated_at` |
| `bot.processed_updates` | `update_id` PK, `at` (7 дней) |
| `bot.subscriptions` | `telegram_user_id`, `topic`, `consent_id`, `unsubscribed_at` |
| `ops.outbox` | `id`, `kind` (telegram_message/job), `payload` jsonb, `dedupe_key`, `priority`, `status` (pending/sent/failed), `attempts`, `send_after`, `created_at` |
| `ops.admin_users` | `id`, `email`, `password_hash` (argon2id), `totp_secret_enc`, `role` (owner/assistant/translator/accountant), `telegram_user_id`, `active`, `failed_logins`, `locked_until` |
| `ops.admin_sessions` | `token_sha256`, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `ip_hash`, `ua` |
| `ops.consents` | `id`, `customer_id` или `subject_ref_hash`, `order_id` (для согласий по заказу), `kind` (pd_processing, ai_transfer_us, marketing, photo_publication, supplier_data_transfer, age_18, analytics_cookies, limit_overrun, non_returnable, replacement, no_receipt_purchase, third_party_payer), `granted`, `document_id`, `text_sha256`, `lang`, `channel`, `evidence` jsonb, `at`; отзыв — новая запись `granted=false` |
| `ops.dsr_requests` | `id`, `customer_id`, `kind` (copy/rectify/erase), `received_at`, `due` (+30 дней), `status`, `result_file_id` |
| `ops.files` | `id`, `sha256`, `mime`, `bytes`, `storage_key`, `kind`, `is_public`, `contains_pd`, `retention_class` (lead_12m/order_warranty_plus_3y/tax_5y/ai_90d/media), `created_by` |
| `ops.settings` | `key`, `value` jsonb, `version`, `updated_by`, `updated_at` — деньги (`FeeSettings` с датой действия), календарь и праздники, часы ответа, флаги, тема сайта, лимиты ИИ, id группы владельца |
| `ops.audit_log` | `at`, `actor`, `action`, `entity`, `entity_id`, `before`, `after`, `ip_hash` |
| `ops.app_errors` | `at`, `app`, `fingerprint`, `message`, `stack` (без ПД), `count`, `last_at` |
| `ops.threshold_snapshots` | `year`, `as_of`, `deals_sum`, `committed_sum`, `limit_sum`, `plan_cap_sum`, `share_bp` |

### 3.4. Ограничения в базе (вторая линия после `domain`)

- `payments` CHECK:
  - `kind IN ('purchase_funds','purchase_topup')` ⇒ `direction='in' AND method='bank_transfer_ip'`;
  - `kind IN ('fee_advance','fee_final','fee_extra','podbor_fee')` ⇒ `direction='in' AND method IN ('xolis_qr','merchant_card') AND (status <> 'confirmed' OR fiscal_receipt_no IS NOT NULL)`;
  - `kind IN ('remainder_refund','fee_refund','funds_refund')` ⇒ `direction='out' AND method='bank_transfer_out'`.
- `orders.contract_scheme <> 'sale'` — схема «продажа» выключена (CONCEPT 5.11).
- Триггер `purchases`: `Σ amount_sum` заказа ≤ `purchase_limit` текущей сметы, иначе нужна запись `ops.consents(kind='limit_overrun', order_id, granted)`; и всегда ≤ `Σ` подтверждённых `purchase_funds + purchase_topup` (своими деньгами за клиента не платим).
- Триггер на `orders.status IN ('closed','cancelled')`: `Σ purchase_funds + purchase_topup = Σ purchases + Σ remainder_refund + Σ funds_refund + documented_losses` (красная линия 13).
- Триггеры «только дописывание» (3.1); у `payments` разрешён только переход статуса из `expected` с полями подтверждения.
- `configurations`, отправленные `quotes` и опубликованные `legal_documents` неизменяемы.
- Одна таблица тестовых случаев денег (`packages/testing/fixtures/money-cases.json`) прогоняется и против `domain`, и против реальной базы: две линии защиты не расходятся.

### 3.5. Объёмы и производительность

- Каталог — до 500 позиций, наблюдения цен — тысячи в месяц, заказы — 4–6 в месяц: индексы — для выборок админки и задач.
- Снимок для конфигуратора (позиции `verified`, текущие медианы, опубликованные правила, настройки денег, курс) — один запрос через `v_market_price_current`, кэш с тегом `catalog`/`prices`; ≈ 40–90 КБ gzip, грузится по шагам.

## 4. Ядро предметной логики (`packages/domain`)

### 4.1. Правила пакета

- Только чистые функции: без `fetch`, базы, `Date.now()` (время — аргументом), случайности (коды генерирует вызывающий), глобальных настроек. Ноль зависимостей во время работы.
- Собирается для Node и браузера: конфигуратор показывает предварительный результат, сервер пересчитывает тем же кодом.
- Тексты не формирует: возвращает `messageKey` и `params`; перевод — `packages/i18n`.
- Настройки (ставки, пороги, сроки) — аргументом; значения по умолчанию совпадают с DECISIONS, тест сверяет их с документом.
- Покрытие строк и ветвей — не ниже 90 %, для денег — 95 %; эталонные сборки — регрессионные тесты.

### 4.2. Деньги

```ts
// packages/domain/src/money/types.ts
/** Whole Uzbek sums. Integer only, never floats, never tiyin. */
export type Sum = number & { readonly __brand: "Sum" };
/** Basis points: 1500 = 15 %. */
export type Bp = number & { readonly __brand: "Bp" };
export type Locale = "uz" | "ru";
export type Localized = Record<Locale, string>;
export type IsoDate = string; // "2026-10-05"

export declare function sum(n: number): Sum;          // throws RangeError unless Number.isSafeInteger
export declare function bp(n: number): Bp;            // integer 0..10_000
export type Rounding = "floor" | "half_up" | "ceil";
/** base × rate / 10 000 with explicit rounding to a whole sum. */
export declare function applyBp(base: Sum, rate: Bp, mode: Rounding): Sum;
/** Rounds to a step (1 000, 10 000) — display and reserve only, never receipts or fee. */
export declare function roundTo(value: Sum, step: number, mode: Rounding): Sum;
/** Splits total by shares (Σ shares = 10 000) with largest-remainder rounding: parts always add up to total. */
export declare function splitByShares(total: Sum, shares: readonly Bp[]): Sum[];
export declare function addSums(...xs: Sum[]): Sum;
```

- Свойства fast-check: `Σ splitByShares(t, s) = t`; `applyBp(b, r, "floor") ≤ b × r / 10 000`; плата в коридоре 10–15 % при базе ≥ 6,7 млн и без сложной сборки.

### 4.3. Каталог и характеристики

```ts
// packages/domain/src/catalog/types.ts
export type ProductId = string & { readonly __brand: "ProductId" };
export type CategoryCode =
  | "cpu" | "mb" | "ram" | "ssd" | "gpu" | "psu" | "case" | "cooler_air" | "aio" | "fan"
  | "monitor" | "arm" | "desk" | "desk_frame" | "desk_top" | "chair"
  | "keyboard" | "mouse" | "mousepad" | "headset" | "microphone" | "webcam"
  | "light" | "speakers" | "acoustic_panel" | "cable_mgmt" | "ups" | "decor" | "os_license";
export type FeeGroup = "pc" | "mount" | "outside_scale";
export type Socket = "AM5" | "AM4" | "LGA1700" | "LGA1851";
export type RamType = "DDR4" | "DDR5";
export type BoardFF = "E-ATX" | "ATX" | "mATX" | "Mini-ITX";
export type PsuFF = "ATX" | "SFX" | "SFX-L";
export type Vesa = "75x75" | "100x100" | "200x100" | "200x200" | "300x300" | "400x400";

export interface CpuSpecs { socket: Socket; cores: number; threads: number; boostGhz: number; tdpW: number;
  maxPowerW: number; hasIgpu: boolean; memTypes: RamType[]; memMaxMts: Partial<Record<RamType, number>>;
  boxCooler: boolean; chipsets: string[]; minBiosByChipset?: Record<string, string>; }
export interface M2Slot { id: string; pcieGen: 3 | 4 | 5; maxLenMm: 42 | 60 | 80 | 110; disablesSata: number[] }
export interface BoardSpecs { socket: Socket; chipset: string; formFactor: BoardFF; ramType: RamType;
  ramSlots: 2 | 4; ramMaxGb: number; ramMaxMts: number; m2: M2Slot[]; sataPorts: number; pcieX16Slots: number;
  fanHeaders: number; argb5vHeaders: number; rgb12vHeaders: number; wifi: boolean; bluetooth: boolean;
  biosFlashback: boolean; shippedBios?: string; }
export interface RamSpecs { type: RamType; kitGb: number; modules: number; mts: number; cl: number;
  profile: "XMP" | "EXPO" | "both" | "none"; heightMm: number; lighting: boolean; }
export interface SsdSpecs { iface: "nvme" | "sata"; formFactor: "M.2-2242" | "M.2-2260" | "M.2-2280" | "2.5";
  capacityGb: number; pcieGen?: 3 | 4 | 5; tbw: number; heatsinkHeightMm?: number; }
export interface GpuSpecs { chip: string; vramGb: number; lengthMm: number; heightMm: number; slots: number;
  power: { conn: "6pin" | "8pin" | "12V-2x6"; count: number }[]; adapterInBox: boolean; tgpW: number;
  vendorRecommendedPsuW: number; hwEncoders: string[]; }
export interface PsuSpecs { watts: number; rating: "none" | "bronze" | "gold" | "platinum" | "titanium";
  formFactor: PsuFF; lengthMm: number; modular: "no" | "semi" | "full"; pcie8pin: number; native12v2x6: number; atx3: boolean; }
export interface RadiatorMount { side: "front" | "top" | "rear" | "side" | "bottom"; sizesMm: (120 | 140 | 240 | 280 | 360 | 420)[]; maxThicknessMm?: number }
export interface CaseSpecs { boards: BoardFF[]; gpuMaxLenMm: number; gpuMaxLenWithFrontRadMm: number;
  coolerMaxHeightMm: number; radiators: RadiatorMount[]; psuFF: PsuFF[]; psuMaxLenMm: number;
  expansionSlots: number; fanMounts: number; fansIncluded: number; dimsMm: { w: number; d: number; h: number }; }
export interface AirCoolerSpecs { sockets: Socket[]; heightMm: number; ramClearanceMm: number; tdpRatedW: number }
export interface AioSpecs { sockets: Socket[]; radMm: 240 | 280 | 360 | 420; radThicknessWithFansMm: number; tubeLenMm: number; pumpW: number }
export interface FanSpecs { sizeMm: 120 | 140; count: number; conn: "3pin" | "4pin"; argb: boolean }
// Setup items (2D plan)
export interface MonitorSpecs { diagIn: number; aspect: "16:9" | "16:10" | "21:9" | "32:9"; resolution: string; hz: number;
  panelWmm: number; panelHmm: number; depthWithStandMm: number; standFootprintMm: { w: number; d: number };
  weightNoStandKg: number; vesa?: Vesa; curved: boolean; }
export interface ArmSpecs { reachMinMm: number; reachMaxMm: number; poleHeightMm: number; mount: "clamp" | "grommet" | "both";
  topThicknessMinMm: number; topThicknessMaxMm: number; vesa: Vesa[]; loadMinKg: number; loadMaxKg: number;
  diagMinIn: number; diagMaxIn: number; screens: 1 | 2 | 3; }
export interface DeskSpecs { topWmm: number; topDmm: number; heightMinMm: number; heightMaxMm: number; topThicknessMm: number;
  legZonesMm: { fromMm: number; toMm: number }[]; cableCutout: boolean; loadKg: number; motors: 0 | 1 | 2; }
export interface ChairSpecs { baseDiamMm: number; seatHeightMinMm: number; seatHeightMaxMm: number; rollbackZoneMm: number;
  userHeightCm: [number, number]; userMaxKg: number; }

/** Unknown value is `null` and yields a "check" (warn) with missingData, never "ok". */
export type Nullable<T> = { [K in keyof T]: T[K] | null };
export type ProductSpecs =
  | { category: "cpu"; spec: Nullable<CpuSpecs> } | { category: "mb"; spec: Nullable<BoardSpecs> }
  | { category: "ram"; spec: Nullable<RamSpecs> } | { category: "ssd"; spec: Nullable<SsdSpecs> }
  | { category: "gpu"; spec: Nullable<GpuSpecs> } | { category: "psu"; spec: Nullable<PsuSpecs> }
  | { category: "case"; spec: Nullable<CaseSpecs> } | { category: "cooler_air"; spec: Nullable<AirCoolerSpecs> }
  | { category: "aio"; spec: Nullable<AioSpecs> } | { category: "fan"; spec: Nullable<FanSpecs> }
  | { category: "monitor"; spec: Nullable<MonitorSpecs> } | { category: "arm"; spec: Nullable<ArmSpecs> }
  | { category: "desk"; spec: Nullable<DeskSpecs> } | { category: "chair"; spec: Nullable<ChairSpecs> }
  | { category: Exclude<CategoryCode, "cpu" | "mb" | "ram" | "ssd" | "gpu" | "psu" | "case" | "cooler_air" | "aio" | "fan" | "monitor" | "arm" | "desk" | "chair">; spec: Record<string, unknown> };

export interface ProductBase { id: ProductId; category: CategoryCode; brand: string; model: string; mpn?: string;
  priceClassId?: string; ladderStep?: number; color: "black" | "white" | "gray" | "other"; lighting: "none" | "rgb" | "argb";
  feeGroup: FeeGroup; returnable: boolean; manualOnly: boolean; status: "draft" | "verified" | "retired"; isDemo: boolean; }
export type Product = ProductBase & ProductSpecs;
export interface CatalogLookup { get(id: ProductId): Product | undefined; byCategory(c: CategoryCode): readonly Product[] }
export interface BuildLine { productId: ProductId; qty: number; customerOwned?: boolean }
```

- zod-схемы тех же форм — в `packages/contracts/src/catalog/specs.ts`; формы админки строятся по ним, владелец не правит JSON.

### 4.4. Совместимость

```ts
// packages/domain/src/compat/types.ts
export type Severity = "block" | "warn";          // «нельзя» / «проверьте»
export type Task = "gaming" | "streaming" | "design3d" | "programming" | "office";
export type RuleId =
  | "CPU_MB_SOCKET" | "CPU_MB_CHIPSET" | "CPU_MB_BIOS" | "CPU_NO_VIDEO"
  | "MEM_TYPE" | "MEM_SLOTS" | "MEM_CAPACITY" | "MEM_SPEED" | "MEM_COOLER_CLEARANCE"
  | "MB_CASE_FORMFACTOR" | "GPU_CASE_LENGTH" | "GPU_SLOT_WIDTH"
  | "COOLER_SOCKET" | "COOLER_CASE_HEIGHT" | "COOLER_TDP" | "AIO_RADIATOR_MOUNT" | "AIO_RADIATOR_THICKNESS"
  | "PSU_WATTAGE" | "PSU_GPU_CONNECTORS" | "PSU_CASE_FORMFACTOR" | "PSU_CASE_LENGTH"
  | "M2_SLOTS" | "M2_LENGTH" | "M2_SATA_SHARING" | "SATA_PORTS" | "ARGB_HEADERS" | "FAN_HEADERS" | "WIFI_FOR_TASK"
  | "DESK_DEPTH_EYES" | "DESK_WIDTH_MONITORS" | "ARM_VESA" | "ARM_LOAD" | "ARM_DIAGONAL" | "ARM_DESK_THICKNESS"
  | "ARM_CLAMP_ZONE" | "CHAIR_ROLLBACK" | "CHAIR_USER_HEIGHT";

export interface CompatIssue {
  ruleId: RuleId; severity: Severity; productIds: ProductId[];
  messageKey: string;                                   // "compat.gpu_too_long"
  params: Record<string, string | number>;              // { gpuMm: 340, caseMm: 330 }
  fix?: { category: CategoryCode; filter: Record<string, string | number | boolean> };
}
export interface PowerEstimate { peakW: number; recommendedPsuW: number; selectedPsuW?: number; headroomBp?: Bp }
export interface CompatResult {
  verdict: "ok" | "warn" | "block" | "incomplete";
  issues: CompatIssue[]; power: PowerEstimate; checkedRules: RuleId[];
  missingData: { productId: ProductId; field: string }[];
}
export interface CompatSettings {
  gpuLenWarnMarginMm: number;      // 10
  coolerHeightWarnMarginMm: number;// 5
  psuMultiplier: number;           // 1.3
  psuHeadroomWarnBp: Bp;           // 3000
  psuSeriesW: number[];            // [550, 650, 750, 850, 1000, 1200]
  baseW: number; perFanW: number; pumpW: number;   // 50, 5, 15
  rollbackZoneMm: number;          // 750 (600–900)
  eyeDistanceMm: [number, number]; // [500, 760]
  standDepthMm: [number, number];  // [150, 250]
}
export interface SetupPlan { room: { widthMm: number; depthMm: number; window?: "left" | "right" | "back"; userHeightCm?: number };
  lines: BuildLine[]; placement?: Record<string, { xMm: number; yMm: number }>; }
export type Rule = (b: ResolvedBuild, ctx: { tasks: Task[]; settings: CompatSettings }) => CompatIssue[];
export interface ResolvedBuild { byCategory: Partial<Record<CategoryCode, { product: Product; qty: number }[]>> }
export declare function checkCompatibility(lines: BuildLine[], catalog: CatalogLookup, ctx: { tasks: Task[]; settings: CompatSettings }): CompatResult;
export declare function checkSetup(plan: SetupPlan, catalog: CatalogLookup, s: CompatSettings): CompatResult;
export declare function estimatePower(lines: BuildLine[], catalog: CatalogLookup, s: CompatSettings): PowerEstimate;
```

| Правило | Проверка | Уровень |
| --- | --- | --- |
| `CPU_MB_SOCKET` | сокет процессора = сокет платы | block |
| `CPU_MB_CHIPSET` | чипсет платы в списке процессора | block |
| `CPU_MB_BIOS` | минимальная версия BIOS выше заводской | warn («прошивка у продавца», если нет flashback) |
| `CPU_NO_VIDEO` | нет встроенной графики и нет видеокарты | block |
| `MEM_TYPE` | тип памяти = тип платы и есть у процессора | block |
| `MEM_SLOTS` / `MEM_CAPACITY` | модулей больше слотов / объём выше максимума платы или процессора | block |
| `MEM_SPEED` | частота выше поддержки — «будет работать на N МТ/с» | warn |
| `MEM_COOLER_CLEARANCE` | высота памяти > зазора кулера | warn |
| `MB_CASE_FORMFACTOR` | форм-фактор платы поддерживается корпусом | block |
| `GPU_CASE_LENGTH` | длина ≤ максимума (с передним радиатором, если выбран) | block; запас < 10 мм — warn |
| `GPU_SLOT_WIDTH` | толщина против слотов корпуса | warn |
| `COOLER_SOCKET` | кулер или СЖО поддерживает сокет | block |
| `COOLER_CASE_HEIGHT` | высота кулера ≤ максимума корпуса | block; запас < 5 мм — warn |
| `COOLER_TDP` | рассеиваемая мощность < максимальной мощности процессора | warn |
| `AIO_RADIATOR_MOUNT` / `AIO_RADIATOR_THICKNESS` | есть место нужного размера / толщина с вентиляторами | block / warn |
| `PSU_WATTAGE` | БП ниже пика — block; ниже `max(ряд(пик × 1,3), рекомендация карты)` или запас < 30 % — warn; пик = maxPower CPU + TGP + 50 + 5 × вентиляторы + 15 при СЖО (блок 28, 3.4) | block / warn |
| `PSU_GPU_CONNECTORS` | разъёмы БП покрывают карту; 12V-2x6 — родной кабель или переходник из комплекта карты (с переходником — warn) | block / warn |
| `PSU_CASE_FORMFACTOR` / `PSU_CASE_LENGTH` | форм-фактор / длина БП | block / warn |
| `M2_SLOTS` / `M2_LENGTH` | NVMe больше слотов / длина накопителя против слота | block |
| `M2_SATA_SHARING` | занятый M.2 отключает используемые SATA | warn |
| `SATA_PORTS` | SATA-накопителей больше портов | block |
| `ARGB_HEADERS` / `FAN_HEADERS` | разъёмов меньше, чем нужно | warn |
| `WIFI_FOR_TASK` | стрим или офис без Wi-Fi и Bluetooth | warn |
| Сетап | `DESK_WIDTH_MONITORS`, `ARM_VESA`, `ARM_LOAD`, `ARM_DESK_THICKNESS` — block; `DESK_DEPTH_EYES`, `ARM_DIAGONAL`, `ARM_CLAMP_ZONE`, `CHAIR_ROLLBACK`, `CHAIR_USER_HEIGHT` — warn | — |

- Каждое правило — файл `compat/rules/<id>.ts` с тестами «нельзя», «проверьте», «нет данных».
- Поле, нужное правилу, равно `null` → `warn` с `compat.missing_data`, позиция в `missingData`, вердикт `incomplete`. «Нет данных» никогда не даёт «ok».
- «Свои детали клиента» (`customerOwned`) проверяются, но не входят в цену.
- Автопроверка — фильтр. Перед отправкой сметы владелец ставит отметку «проверено вручную» (4.9).

### 4.5. Цена по рынку и курс

```ts
// packages/domain/src/market/types.ts
export interface PriceObservation { id: string; productId: ProductId; vendorId: string;
  vendorKind: "partner" | "shop" | "marketplace_seller" | "private"; observedAt: Date; priceSum: Sum;
  availability: "in_stock" | "on_order" | "preorder" | "ask"; condition: "new" | "refurb" | "used"; isFromPrice: boolean; }
export interface FxRate { ccy: "USD" | "EUR" | "RUB"; rate: string; nominal: number; effectiveDate: IsoDate }
export interface MarketPolicy {
  freshnessDays: number;                  // 7; GPU volatile 3; furniture 30 (by category)
  minVendors: number;                     // 3
  smallSampleBand: [number, number];      // [0.6, 1.6] for 3–5 offers
  madK: number;                           // 3.5 (× 1.4826 × MAD) for ≥ 6 offers
  currencyErrorRatio: number;             // 1000: price < median / 1000 → dollars typed into sums
  high: { vendors: number; maxAgeDays: number };   // 5, 3
}
export type ExcludeReason = "outlier" | "currency_error" | "stale" | "not_in_stock" | "from_price" | "private_seller" | "duplicate_vendor" | "used_or_refurb";
export interface MarketPrice { productId: ProductId; asOf: Date; median: Sum | null; from: Sum | null; min: Sum | null; max: Sum | null;
  offers: number; vendors: number; maxAgeDays: number; confidence: "high" | "medium" | "low";
  flags: ("outlier_removed" | "currency_suspect" | "same_price_cluster")[];
  excluded: { observationId: string; reason: ExcludeReason }[]; }
/** decimal-string rate × amount / nominal, half-up to whole sums; no floats in money. */
export declare function convertToSum(amount: string, fx: FxRate): Sum;
export declare function computeMarketPrice(obs: readonly PriceObservation[], now: Date, policy: MarketPolicy): MarketPrice;
```

- Порядок (блок 08, 5.2–5.4): новые и в наличии → без «цены от» и частных лиц → не старше срока свежести → одна цена на продавца (минимальная) → ошибка валюты → выбросы (3–5 предложений — полоса 0,6–1,6 медианы; от 6 — MAD) → медиана (чётное число — среднее двух средних, округление вверх до сума) → «от» = минимум после фильтров → доверие.
- Меньше трёх продавцов — `median = null`, `confidence = "low"`, клиенту — «цена уточняется, от X».
- Доверие: high — ≥ 5 продавцов и ≤ 3 дней; medium — 3–4 продавца или 4–7 дней; low — остальное.
- Тест-пример: курс `"11772.95"` × 1 000 $ = 11 772 950 сум; RX 550 за 39 млн отсекается.
- Время наблюдения: позже `asOf` не более чем на 24 часа (часовые пояса) — возраст 0; больше — `RangeError`, ошибка данных, как цена ≤ 0 (ADR-007).

### 4.6. Плата, смета, этапы

```ts
// packages/domain/src/fee/types.ts
export interface FeeSettings {
  version: string; effectiveFrom: IsoDate;                  // published price list with date (GK art. 662)
  pcLowRateBp: Bp; pcHighRateBp: Bp; pcThreshold: Sum; pcHighMinFee: Sum;   // 1500, 1000, 20 000 000, 3 000 000
  mountRateBp: Bp; complexRateBp: Bp;                       // 1500, 1500
  minFullCyclePc: Sum; minFreeWindowPc: Sum; minFullCycleSetup: Sum;        // 6 700 000, 4 500 000, 13 300 000
  stageSharesBp: { selection: Bp; purchase: Bp; assembly: Bp; handover: Bp }; // 2000/3000/3500/1500, Σ = 10 000
  commissionLineStages: readonly ("selection" | "purchase" | "assembly" | "handover")[]; // ["selection","purchase"] → 50 %
  advanceBp: Bp;                                            // 3000: 30 % at acceptance, 70 % at handover
  reserveBp: Bp; reserveHighBp: Bp; reserveHighShareBp: Bp; // 300, 500, 2500 (RAM+SSD ≥ 25 % → 5 %; owner confirms)
  reserveRoundStep: number;                                 // 10 000, round up
  podborShareBp: Bp; podborCreditDays: number;              // 2000, 30
  afterTestsRetainBp: Bp;                                   // 8500 (lawyer confirms with the offer)
  shelfLifeHours: { components: number; furniture: number };// 24, 72
}
export interface QuoteLineInput { key: string; productId?: ProductId; group: FeeGroup; qty: number; unitSum: Sum;
  isRamOrSsd: boolean; isFurnitureLike: boolean; customerOwned: boolean; purchasedByIp: boolean; }
export interface FeePart { group: "pc" | "mount"; base: Sum; rateBp: Bp; amount: Sum;
  rule: "pc_low" | "pc_high" | "pc_high_min" | "mount" | "complex"; }
export interface FeeBreakdown { parts: FeePart[]; total: Sum; effectiveRateBp: Bp;
  commissionLine: Sum;   // «вознаграждение за закупку и ручательство»
  worksLine: Sum;        // «работы»; commissionLine + worksLine === total
}
export type Eligibility =
  | { mode: "full_cycle" } | { mode: "free_window_only"; minEstimate: Sum }
  | { mode: "podbor_only"; reason: "below_min" | "region" | "manual" } | { mode: "setup_below_min" };
export interface QuoteTotals {
  componentsSum: Sum;          // fee base: pc + mount groups, customer-owned excluded
  outsideScaleSum: Sum;        // licenses, freight, partner works: no fee
  reserveBp: Bp; reserveSum: Sum;
  purchaseLimit: Sum;          // Σ purchasedByIp lines + reserve → transferred to the IP account
  fee: FeeBreakdown; advance: Sum; final: Sum;   // advance + final === fee.total
  grandTotal: Sum;             // purchaseLimit + fee.total
  eligibility: Eligibility; validUntil?: Date;   // only for an owner-confirmed estimate
  warnings: { key: string; params?: Record<string, string | number> }[];   // price uncertain, demo data
}
export declare function computeFee(lines: readonly QuoteLineInput[], s: FeeSettings, o: { complexBuild: boolean }): FeeBreakdown;
export declare function computeQuote(lines: readonly QuoteLineInput[], s: FeeSettings,
  ctx: { now: Date; kind: "pc" | "setup"; complexBuild: boolean; freeWindowAvailable: boolean; confirmed: boolean }): QuoteTotals;
export declare function podborFee(fee: FeeBreakdown, s: FeeSettings): Sum;
export declare function partsBudgetFromTotal(total: Sum, s: FeeSettings, reserveBp: Bp): Sum;
```

Формулы и решения по округлению:

- Группа `pc`: база < 20 млн → `floor(15 %)`; база ≥ 20 млн → `max(floor(10 %), 3 000 000)`; сложная сборка — `floor(15 %)` при любой базе. Группа `mount` — `floor(15 %)`. `outside_scale` — 0. Скачка на 20 млн нет.
- Решение: плата округляется вниз до целого сума, а не до 1 000. Причина: прейскурант публикуется с датой, цена бытового подряда не может быть выше прейскуранта (ГК ст. 662), а округление вверх выводит ставку за 15 %.
- Аванс — `splitByShares(fee, [3000, 7000])`; строки «вознаграждение» и «работы» — `splitByShares(fee, [Σ долей commissionLineStages, остаток])`, сейчас 50/50 по прейскуранту этапов. Одно правило с расчётом отказа.
- Резерв — 3 %, 5 % при доле памяти и SSD ≥ 25 % (настройка, утверждает владелец), округление вверх до 10 000 сум; лимит закупки = строки, которые закупает ИП, + резерв. Резерв возвращается по чекам.
- Строки сметы — целая медиана без округления вверх (красная линия 2). Округление до 1 000 — только в показе ориентира конфигуратора.
- Допуск: ПК ≥ 6,7 млн — полный цикл; 4,5–6,7 млн — только при свободном окне (в работе < 2 заказов и нет очереди от 6,7 млн — считает `services`); ниже — «Подбор»; сетап с монтажом ≥ 13,3 млн.
- Срок сметы: 72 ч, только если все строки — мебель, свет, декор, акустика; иначе 24 ч.
- Бюджет клиента → детали: `parts = total / (1 + rate + reserve)` по двум веткам шкалы, берётся согласованная.
- «Подбор»: `floor(20 % платы по шкале)`, зачёт в плату при заказе в течение 30 дней.
- Тест-таблица CONCEPT 1.2: 5 → 0,75; 10 → 1,50; 15 → 2,25; 25 → 3,00; 40 → 4,00; 60 → 6,00 млн; сетап 17,5 + 7,5 → 3,75 млн.

### 4.7. Отказ клиента

```ts
// packages/domain/src/cancel/types.ts
export type CancelPoint = "before_accept" | "after_accept_before_purchase" | "after_purchase_before_assembly"
  | "during_assembly" | "after_tests_before_handover";
export interface CancelInput { point: CancelPoint; fee: Sum; feePaid: Sum; fundsReceived: Sum; receiptsTotal: Sum;
  shopRefunds: Sum; documentedLosses: Sum; assemblyDoneBp?: Bp; }   // assemblyDoneBp — owner input, journaled
export interface CancelSettlement {
  feeEarned: Sum;        // by stage price list
  feeToRefund: Sum;      // paid more than earned
  feeToInvoice: Sum;     // earned more than paid: separate QR payment with receipt, never offset from purchase funds
  fundsToRefund: Sum;    // fundsReceived − receiptsTotal + shopRefunds − documentedLosses
  partsGoTo: "none" | "client" | "shop_or_client";
  dueBy: Date;           // +5 working days
}
export declare function settleCancellation(i: CancelInput, s: FeeSettings, now: Date, cal: WorkCalendar): CancelSettlement;
```

| Момент | Заработано платы | Деньги на закупку |
| --- | --- | --- |
| `before_accept` | 0 | всё |
| `after_accept_before_purchase` | 20 % (из 30 % аванса возвращается 10 %) | всё за 5 рабочих дней |
| `after_purchase_before_assembly` | 50 % + фактические потери по чекам | остаток; детали — клиенту или в магазин, если он принимает |
| `during_assembly` | 50 % + `assemblyDoneBp` × 35 % | остаток; детали или ПК — клиенту |
| `after_tests_before_handover` | `afterTestsRetainBp` (85 %: этап «сдача» не выполнен) | остаток |

- Расхождение для юриста: 02b — «вся плата, если собран и протестирован»; CONCEPT 2.5 и ЗоЗПП ст. 21 ч. 2 — плата за выполненное. Код берёт 85 % настройкой.

### 4.8. Резервы и порог

```ts
// packages/domain/src/threshold/types.ts
export interface DealEntry { kind: "receipt" | "fee_in" | "fee_refund" | "other_income"; amount: Sum; date: IsoDate }
export interface ThresholdSettings { annualLimit: Sum; registrationDate?: IsoDate; planCap?: Sum; alertsBp: readonly Bp[];
  proportion: "without_registration_day" | "with_registration_day"; }   // default: without (lower bound)
export interface ThresholdStatus { year: number; limit: Sum; volume: Sum; committed: Sum; shareBp: Bp;
  projectedShareBp: Bp; crossedAlerts: Bp[]; overPlanCap: boolean; remaining: Sum; }
/** Registration year: floor(annualLimit / daysInYear × days). */
export declare function thresholdForYear(year: number, s: ThresholdSettings): Sum;
export declare function thresholdStatus(entries: readonly DealEntry[], committed: Sum, year: number, s: ThresholdSettings): ThresholdStatus;
export interface WarrantyReserveState { balance: Sum; closedOrders: number; lossesLast12mBp: Bp }
export declare function warrantyReserveContribution(componentsSum: Sum, st: WarrantyReserveState): Sum;
export declare function taxRiskReserve(receiptsTotal: Sum, active: boolean): Sum;
```

- Сделки года (НК ст. 462 ч. 9) = чеки закупок + полученная плата (`fee_*`, `podbor_fee`) − возвраты платы + доход другой деятельности ИП (`sales.other_income`). Возвращённый резерв — не сделка (02b 3.3; вопрос в Налоговый комитет).
- `committed` — принятые сметы без закупки: лимит закупки + плата.
- Порог 1 000 000 000 сум; год регистрации — пропорция. Тест: регистрация 15.10.2026 → 210 958 904 (без дня) и 213 698 630 (с днём); 01.11.2026 → 164 383 561 и 167 123 287. План 2026 — 200 000 000 (Р-7).
- Оповещения — 60, 70 (бухгалтер уровня 2), 80, 90, 100 % и прогноз выше плана.
- Резерв гарантии — 2 % комплектующих, не меньше 150 000 сум, пока баланс < 10 млн или закрыто < 30 заказов; затем 1 %, если потери за 12 месяцев < 0,5 %. Налоговый резерв — 1 % закупок до письменного ответа налоговой.

### 4.9. Автомат заказа

```ts
// packages/domain/src/order/types.ts
export type OrderStatus =
  | "estimate_draft" | "estimate_sent" | "estimate_expired"
  | "accepted"                 // offer + estimate accepted; waiting for 30 % fee and purchase funds (two flags)
  | "purchasing" | "report_due" | "report_sent" | "settled"
  | "assembling" | "testing" | "ready" | "delivering" | "handed_over" | "closed"
  | "podbor_delivered" | "cancelling" | "cancelled";
export type Actor = "system" | "customer" | "owner" | "assistant";
export type OrderEvent =
  | { type: "SEND_ESTIMATE"; quoteId: string; manuallyChecked: true }
  | { type: "EXPIRE" } | { type: "REVISE" }
  | { type: "ACCEPT"; quoteId: string; consentIds: string[]; channel: "bot" | "site" | "tma" }
  | { type: "FEE_PREPAID"; paymentId: string } | { type: "FUNDS_RECEIVED"; paymentIds: string[]; receivedAt: Date }
  | { type: "MEETING_DONE" }
  | { type: "START_PURCHASE" } | { type: "PURCHASE_RECORDED"; purchaseId: string } | { type: "PURCHASE_DONE" }
  | { type: "SEND_REPORT"; reportId: string } | { type: "OBJECTION"; text: string }
  | { type: "REPORT_ACCEPTED" } | { type: "REPORT_DEEMED_ACCEPTED" }
  | { type: "REMAINDER_SETTLED"; refundPaymentId?: string }
  | { type: "MATERIALS_ACCEPTED"; actId: string } | { type: "ASSEMBLED" } | { type: "TESTS_PASSED"; passportId: string }
  | { type: "DISPATCH" } | { type: "HANDOVER"; actId: string; finalPaymentId: string } | { type: "CLOSE" }
  | { type: "PODBOR_DELIVERED"; paymentId: string }
  | { type: "CANCEL"; point: CancelPoint; reason: string; settlement: CancelSettlement } | { type: "CANCEL_SETTLED" };
export interface OrderSnapshot {
  status: OrderStatus; kind: "pc" | "setup" | "podbor" | "upgrade";
  flags: { feePrepaid: boolean; fundsReceived: boolean; firstOrderMeetingDone: boolean };
  quote?: { id: string; status: string; validUntil?: Date; compatVerdict: CompatResult["verdict"]; manuallyChecked: boolean;
    eligibility: Eligibility; purchaseLimit: Sum; advance: Sum; final: Sum; hasNonReturnable: boolean };
  money: { fundsReceived: Sum; receiptsTotal: Sum; refunded: Sum; documentedLosses: Sum; hasLimitOverrunConsent: boolean };
  purchasesComplete: boolean; report?: { accepted: boolean; objectionOpen: boolean; objectionUntil: Date | null };
  firstOrderOfCustomer: boolean; grandTotal: Sum; purchaseNotBefore?: Date;
  offer: { uz: "stub" | "lawyer_approved" | "published"; ru: "stub" | "lawyer_approved" | "published" };
  appMode: "development" | "staging" | "production";
  reserves: { warranty: WarrantyReserveState; taxRiskActive: boolean };   // ADR-007: входы правил резервов WP-01
}
export type Effect =
  | { kind: "notify"; to: "customer" | "owner_topic"; templateKey: string; params?: Record<string, string | number> }
  | { kind: "schedule"; job: "estimate_expiry" | "report_due" | "objection_window" | "refund_due" | "warranty_end" | "aftercare"; at: Date }
  | { kind: "render_pdf"; doc: "quote" | "commission_report" | "act_materials" | "act_customer_parts" | "act_handover" | "passport" | "warranty"; watermarkDraft: boolean }
  | { kind: "expect_payment"; paymentKind: "fee_advance" | "purchase_funds" | "fee_final" | "fee_extra" | "remainder_refund" | "fee_refund" | "funds_refund"; amount: Sum }
  | { kind: "ledger"; fund: "warranty" | "tax_risk"; amount: Sum }
  | { kind: "set"; field: "purchaseNotBefore" | "warrantyUntil" | "reportDueAt" | "objectionUntil" | "refundDueAt" | "podborCreditUntil"; at: Date };
export type GuardError =
  | "actor_not_allowed" | "invalid_transition" | "estimate_expired" | "manual_check_missing" | "compat_block"
  | "not_eligible" | "offer_not_published" | "consent_missing" | "payments_incomplete" | "purchase_too_early"
  | "meeting_required" | "limit_exceeded" | "funds_exceeded" | "purchases_incomplete" | "not_reconciled"
  | "report_objection_open" | "final_payment_missing" | "act_missing" | "passport_missing";
export type TransitionResult = { ok: true; next: OrderStatus; effects: Effect[] } | { ok: false; error: GuardError };
export interface WorkCalendar { isWorkingDay(d: IsoDate): boolean; addWorkingDays(from: Date, n: number): Date;
  nextWorkingDayStart(from: Date): Date; isResponseHours(at: Date): boolean; }   // Mon–Sat, UZ holidays, Asia/Tashkent, 10:00–19:00
export declare function transition(o: OrderSnapshot, e: OrderEvent, actor: Actor, now: Date, cal: WorkCalendar, s: FeeSettings): TransitionResult;
export declare function customerStatus(s: OrderStatus): "submitted" | "estimate_confirmed" | "prepaid" | "purchasing"
  | "receipts_summary" | "assembly_test" | "ready" | "handed_over" | "cancelled";
```

| Из | Событие | В | Кто | Защита (guard) | Эффекты |
| --- | --- | --- | --- | --- | --- |
| `estimate_draft` | `SEND_ESTIMATE` | `estimate_sent` | owner | `manuallyChecked`; вердикт не `block`; допуск по минимальной смете; оферта-заглушка допустима (Р-25) | PDF uz/ru (водяной знак «не оферта», если оферта не опубликована), уведомление, `estimate_expiry` через 24/72 ч |
| `estimate_sent` | `EXPIRE` | `estimate_expired` | system | `now > validUntil` | «цены могли измениться» |
| `estimate_sent`, `estimate_expired` | `REVISE` | `estimate_draft` | owner | — | новая версия сметы |
| `estimate_sent` | `ACCEPT` | `accepted` | customer | смета не истекла; узбекская и русская оферты `published` (в любом режиме, кроме `development`); согласия `pd_processing`, `supplier_data_transfer`, `non_returnable` при таких строках | `expect_payment` аванса и денег на закупку, экран оплаты, напоминание через 24 ч |
| `accepted` | `FEE_PREPAID` | `accepted` | owner | платёж `fee_advance`, `xolis_qr`, чек, сумма = аванс, плательщик — клиент или заявление третьего лица | флаг |
| `accepted` | `FUNDS_RECEIVED` | `accepted` | owner | `Σ purchase_funds` подтверждено ≥ лимита; только `bank_transfer_ip` | флаг; `purchaseNotBefore = nextWorkingDayStart(receivedAt)` |
| `accepted` | `MEETING_DONE` | `accepted` | owner | — | флаг встречи или видеозвонка |
| `accepted` | `START_PURCHASE` | `purchasing` | owner | оба флага; `now ≥ purchaseNotBefore`; первый заказ клиента от 15 млн — встреча | — |
| `purchasing` | `PURCHASE_RECORDED` | `purchasing` | owner, assistant | `Σ` чеков ≤ лимита или согласие `limit_overrun`; `Σ` чеков ≤ полученных денег; чек или ЭСФ и фото, либо согласие `no_receipt_purchase` | фото чека клиенту |
| `purchasing` | `PURCHASE_DONE` | `report_due` | owner | все строки закуплены или сняты с согласием `replacement` | `reportDueAt` = +24 ч (цель), крайний +48 ч |
| `report_due` | `SEND_REPORT` | `report_sent` | owner | отчёт собран из закупок | PDF; `objectionUntil` +3 рабочих дня; `refundDueAt` +5 рабочих дней |
| `report_sent` | `OBJECTION` | `report_sent` | customer | не позже `objectionUntil`; отчёт не принят | тема владельцу |
| `report_sent` | `REPORT_ACCEPTED` / `REPORT_DEEMED_ACCEPTED` | `report_sent` | customer / system | нет открытых возражений; для deemed — `now` строго позже `objectionUntil` | — |
| `report_sent` | `REMAINDER_SETTLED` | `settled` | owner | отчёт принят; `fundsReceived = receiptsTotal + refunded`; возврат остатка подтверждён или остаток 0 | отчисление в налоговый резерв (`taxRiskReserve`) |
| `settled` | `MATERIALS_ACCEPTED` | `assembling` | owner | акт приёма материала заказчика (ГК ст. 661) | — |
| `assembling` | `ASSEMBLED` | `testing` | owner, assistant | — | фото этапов клиенту |
| `testing` | `TESTS_PASSED` | `ready` | owner, assistant | протокол 6–8 ч без ошибок, паспорт заполнен | PDF паспорта |
| `ready` | `DISPATCH` | `delivering` | owner | окно согласовано | — |
| `delivering` | `HANDOVER` | `handed_over` | owner (+ кнопка клиента) | акт сдачи; `fee_final` подтверждён через QR с чеком | `warrantyUntil` = +12 мес.; резерв гарантии (`warrantyReserveContribution`); aftercare 7 и 30 дней; гарантии магазинов −30 дней |
| `handed_over` | `CLOSE` | `closed` | system | сведено; все документы; нет открытых возражений | — |
| `estimate_sent` (вид `podbor`) | `PODBOR_DELIVERED` | `podbor_delivered` | owner | оферта uz и ru опубликована; `podbor_fee` с чеком через QR | `set podborCreditUntil` = +`podborCreditDays` суток (без задачи `aftercare`) |
| любое до `handed_over` | `CANCEL` | `cancelling` | owner (по заявлению клиента) | `settleCancellation` посчитан | `expect_payment` возвратов и `fee_extra`; корректировка дохода (НК ст. 466) — задача бухгалтеру |
| `cancelling` | `CANCEL_SETTLED` | `cancelled` | owner | все ожидаемые платежи подтверждены или аннулированы с причиной; сверка денег | — |

- Помощник не вызывает денежные события: `FEE_PREPAID`, `FUNDS_RECEIVED`, `START_PURCHASE`, `REMAINDER_SETTLED`, `HANDOVER`, `CANCEL`, `CANCEL_SETTLED`, `SEND_ESTIMATE`.
- `closed` наступает сразу после сверки и сдачи; гарантия идёт по `warrantyUntil` и автомату 4.10, а не состоянием на 12 месяцев.
- Проекция для клиента (CONCEPT 5.9): `estimate_*` → «Смета», `accepted` → «Ждём предоплату» / «Предоплата получена», `purchasing`, `report_due` → «Закупка», `report_sent`, `settled` → «Итог по чекам», `assembling`, `testing` → «Сборка и тест», `ready`, `delivering` → «Готово к выдаче», `handed_over`, `closed` → «Сдано».

### 4.10. Гарантийный случай

- `opened → diagnosing → (loaner_issued) → (at_supplier) → resolved | rejected → closed`.
- Сроки от `opened_at` по календарю 4.9: ответ — 1 рабочий день, диагностика — 2 рабочих дня, подменный товар — 3 суток, устранение — 10 рабочих дней (работа) или 20 дней (детали).
- Отказ — только с причинной связью (`client_fault`): удар, жидкость, разгон, замена не исполнителем.

### 4.11. Автосборка

```ts
// packages/domain/src/autobuild/types.ts
export type Tier = "T1" | "T2" | "T3" | "T4";         // parts: < 12M, 12–20M, 20–35M, ≥ 35M
export interface StylePrefs { color: "black" | "white" | "any"; lighting: "none" | "calm" | "custom";
  size: "compact" | "regular" | "large"; quiet: boolean; }
export interface AutobuildInput { tasks: [Task] | [Task, Task]; totalBudget: Sum | "show_options"; style: StylePrefs; owned?: BuildLine[] }
export interface BaseBuildTemplate { key: string; task: Task; tier: Tier; style: "A" | "B"; variant: "base" | "plus";
  status: "offered" | "not_offered"; redirectTask?: Task;
  slots: { slot: CategoryCode; priceClassId?: string; productId?: ProductId; qty: number }[]; }
export interface SelectionSettings {
  tierBounds: { t1: Sum; t2: Sum; t3: Sum };                       // 12 / 20 / 35 M
  ladders: Record<"gpu" | "cpu" | "ram" | "ssd", string[]>;       // ordered price class keys
  primaryLadder: Record<Task, ("gpu" | "cpu" | "ram" | "ssd")[]>; // block 28, 1.5
  secondaryOrder: Record<Task, ("gpu" | "cpu" | "ram" | "ssd")[]>;
  minimums: Record<Task, { minTier?: Tier; minRamGb?: number; minVramGb?: number; requiresGpu?: boolean }>;
  budgetTolerance: Bp;                                            // 1000
  whiteSurchargeMax: Bp;                                          // 1000
  manualOnlyClassKeys: string[]; manualOnlyPartAbove: Sum;        // RTX 5090, 128 GB, ITX, Threadripper; 60 M
}
export interface Candidate { lines: BuildLine[]; partsSum: Sum; quote: QuoteTotals; compat: CompatResult }
export interface AutobuildResult { tier: Tier; templateKey: string; main: Candidate; cheaper?: Candidate; stronger?: Candidate;
  explanation: { messageKey: string; params: Record<string, string | number> }[];
  notOffered?: { messageKey: string; suggestTask?: Task }; priceUncertain: ProductId[]; }
export declare function autobuild(input: AutobuildInput, data: { catalog: CatalogLookup; prices: ReadonlyMap<ProductId, MarketPrice>;
  templates: readonly BaseBuildTemplate[]; sel: SelectionSettings; fee: FeeSettings; compat: CompatSettings; now: Date }): AutobuildResult;
export declare function replacementOptions(lines: BuildLine[], slot: CategoryCode, data: { catalog: CatalogLookup;
  prices: ReadonlyMap<ProductId, MarketPrice>; compat: CompatSettings }, limit: number):
  { productId: ProductId; deltaSum: Sum; disabledReasonKey?: string }[];
```

- Алгоритм — блок 28, 1.5: бюджет → детали → уровень → шаблон (задача, уровень, стиль, вариант) → подгонка ±10 % главной лестницей, затем памятью, затем SSD → две задачи — старшее требование по категории → фильтр стиля → совместимость (не прошла — следующий кандидат ступени) → цена конвейера → «дешевле» и «мощнее» — соседние ступени.
- Кандидат ступени — позиция `verified` с ценой не `low`; при `low` — с пометкой «цена уточняется». `manualOnly` в автосборку не попадает.
- 32 шаблона, 8 клеток «не предлагаем» (Стрим Т1, Офис Т2–Т4) → `notOffered` с переходом на другую задачу; «Офис Т1+» — вариант `plus` с общим шаблоном «Программирование Т1».

### 4.12. Узбекский текст

```ts
// packages/domain/src/text/uz.ts — re-exported by packages/i18n
/** oʻ, gʻ: ' ‘ ’ ` ʼ after o/O/g/G → U+02BB; other apostrophes between letters → U+02BC (block 26, 7.2). */
export declare function normalizeUz(input: string): string;
/** Search key: normalized, lowercased, apostrophes folded: "o'yin" finds "oʻyin". */
export declare function uzSearchKey(input: string): string;
```

### 4.13. Слой сценариев (`packages/services`)

```ts
// packages/services/src/orders/dispatch.ts
export interface ActorRef { kind: Actor; id: string }      // admin user id, telegram user id, "system"
export type DispatchResult = { ok: true; status: OrderStatus } | { ok: false; error: GuardError };
/** Reads snapshot, calls domain.transition, then in ONE transaction: status, order_events, audit_log, ops.outbox (notify + jobs). */
export declare function dispatch(orderId: string, event: OrderEvent, actor: ActorRef): Promise<DispatchResult>;
```

- Прямой `UPDATE orders.status` запрещён: колонку меняет только функция `sales.apply_transition()` (SECURITY DEFINER), которую вызывает `dispatch`; триггер отклоняет иные изменения статуса.
- Эффекты исполняются после фиксации: worker забирает `ops.outbox` (сообщения Telegram с троттлингом, задачи pg-boss), повторы идемпотентны (`dedupe_key`).
- Другие сценарии: `leads.create`, `leads.convert`, `quotes.build` (пересчёт `computeQuote` на сервере; присланные суммы игнорируются), `quotes.send`, `payments.expect/confirm/void`, `purchases.record`, `reports.generate`, `acts.generate`, `configs.save`, `consents.record`, `threshold.status`.

## 5. Сайт (`apps/web`)

### 5.1. Маршруты

| Маршрут | Содержание | Рендеринг | Выпуск |
| --- | --- | --- | --- |
| `/` | Редирект на `/uz` или `/ru` (cookie `NEXT_LOCALE`, затем `Accept-Language`: `ru` → `/ru`, иначе `/uz`) | `proxy.ts` | R0 |
| `/[locale]` | R0 — одна страница (как работаем, прейскурант с датой, гарантия, возврат, реквизиты, заявка); R1 — «Путь от заявки», три входа, витрина; R2 — сцена | кэш компонентов (`use cache`, `cacheTag`), теги `content`, `fee`, `prices`, `settings` | R0 → R2 |
| `/[locale]/pc`, `/pc/parts`, `/pc/builds/[slug]` | Конфигуратор ПК, режим «по деталям», 6–9 витринных сборок | серверная оболочка + клиентский остров; снимок каталога — кэш | R1 |
| `/[locale]/setup` | Конфигуратор сетапа с 2D-планом | как `/pc` | R2 |
| `/[locale]/services/[task]` | gaming, streaming, design-3d, programming, office | кэш, `content` | R1 (3–4) |
| `/[locale]/ideas`, `/ideas/[id]` | «Идеи»: превью, встраивание по нажатию | кэш, `ideas`; без разбора — `noindex` | R1 |
| `/[locale]/portfolio` | Концепты с пометкой и свои сборки | кэш | R1 |
| `/[locale]/how-we-work`, `/prices`, `/warranty`, `/faq` | Этапы, деньги, чеки, гарантия, прейскурант с датой | кэш, `content`, `fee` | R0 (в одной странице) → R1 |
| `/[locale]/legal/[doc]`, `/requisites` | Оферта, возврат, гарантия, политика ПД, согласия, прейскурант этапов, реквизиты; у заглушки — плашка «Черновик до проверки юристом» | кэш, `legal` | R0 |
| `/[locale]/s/[code]` | Сохранённая сборка (неизменяемый снимок); «Пересчитать», если старше 24 ч | SSR, кэш по коду | R1 |
| `/[locale]/consultant` | «Как работает консультант» (ст. 10 Этических правил ИИ) | кэш | R2 |
| `/[locale]/account/**` | Кабинет: заявки, сметы, чеки, документы, статусы, возражение, подтверждение акта | динамический; вход через Telegram или одноразовую ссылку | R2 |
| `/tma/**` | Mini App | динамический, `noindex` | V1 |
| `/api/ai/chat` | Поток ответа ИИ (SSE) | Route Handler, Node | R2 |
| `/api/tma/session` | Обмен `initData` на токен | Route Handler | V1 |
| `/api/internal/revalidate` | Инвалидация тегов от admin и worker; HMAC, только внутренняя сеть | Route Handler | R0 |
| `/sitemap.xml`, `/robots.txt`, `/healthz` | `alternates` uz/ru; проверка БД и очереди | генерация | R0 |

- Пути — нейтральные латиницей и одинаковые в обоих языках: ссылки из бота и рекламы не ломаются при правке переводов. Отличие от блока 15 (`/idei/`); узбекские пути при желании — `pathnames` next-intl без смены структуры.
- Серверные действия: `saveConfiguration`, `submitLead`, `recalculate`, `acceptQuote` (R2). Все входы — zod; расчёт и совместимость — на сервере тем же `domain`; клиентский расчёт — предварительный, расхождение пишется в журнал.

### 5.2. i18n uz/ru

- next-intl 4.14.9, `localePrefix: "always"`, локали `["uz", "ru"]`, по умолчанию `uz`. `<html lang="uz-Latn">` / `lang="ru"`; `alternates.languages` с `x-default` → `/uz/...`.
- Сообщения — ICU JSON `packages/i18n/messages/{uz,ru}/<namespace>.json` (common, site, configurator, bot, pdf, ai, legal-ui); метаданные для переводчика — `messages/meta/<namespace>.json` (`{ key: { context, maxLen, screenshot } }`). Админка — только русский, ключи не переводятся.
- Поток переводчика: `pnpm i18n:export` → XLSX (ключ, контекст, лимит, ru, uz, ссылка на снимок) → переводчик правит uz → `pnpm i18n:import` с проверками (ключи, плейсхолдеры ICU, лимит, апострофы, глоссарий) → PR.
- Плейсхолдеры uz и ru совпадают по именам и типам. Исключение — числовой аргумент: если в русском он `number`, `plural` или `selectordinal`, в узбекском допустимы `{n}`, `number` и `plural` («{count} ta …» без склонения), ADR-005. Регистрация пространств — правило в `docs/arch/OWNERSHIP.md`. Тексты в базе (страницы, FAQ, `policy_texts`, разборы «Идей») правит роль `translator` в админке.
- Проверки в CI: одинаковые ключи uz и ru; в узбекских строках нет U+0027 и U+2019 внутри слов (только U+02BB после o/g и U+02BC); `callback_data` ≤ 64 байт; длина кнопок — по лимитам Telegram с запасом 30 %; нет `$` и `USD` в сообщениях.
- `formatSum(12500000, "uz")` → `12 500 000 soʻm` (неразрывные пробелы); функция не принимает другую валюту. Даты `02.11.2026`, время `14:30`, `Asia/Tashkent`.
- Узбекский первым, русский вторым; юридические документы при расхождении — главнее узбекский (Р-25). Скрипт перевода на новую латиницу (oʻ→ö, gʻ→ğ, sh→ş, ch→ç) — `tools/uz-new-latin.mjs` со списком исключений, включается после публикации закона.

### 5.3. Конфигуратор ПК (R1)

- Шаги: задача (одна или две) → бюджет ползунком в сумах или «покажите варианты» → стиль → автосборка с объяснением, «дешевле» и «мощнее» → замена детали (3–7 вариантов с разницей; неактивные — с причиной) → итог → сохранить и отправить. Отдельный вход «по деталям».
- Данные: серверная часть отдаёт тонкий снимок (позиции `verified`, характеристики для проверок, медианы и доверие, опубликованные правила, настройки платы, курс), по категориям и шагам. Логика в браузере — `domain` (INP < 200 мс).
- Итог: «детали по рынку на дату» (цена каждой позиции, «от», «цена уточняется»), «резерв 3–5 %, возвращается по чекам», две строки платы, доставка; срок не показывается — это ориентир.
- Сохранение: `saveConfiguration` пересчитывает на сервере и пишет неизменяемый снимок с `engine_version` и `rule_set_version`, выдаёт `/s/{code}`; «Скачать расчёт» — PDF с пометкой «Ориентир на дату, не смета».
- Заявка — без регистрации: телефон или Telegram, согласие на ПД с версией текста, ловушка для ботов, 3 заявки в сутки на телефон, Telegram ID и IP-хэш.
- Производительность сборки — класс («1080p, высокие настройки») с пометкой «оценка» и ссылками на обзоры; для 3D — Blender Open Data с датой; кадров в секунду нет (Р-13).
- Изображения — 2D-рендеры корпуса в цвете (4–6 ракурсов) или нейтральные силуэты, AVIF ≤ 30 КБ; 3D — версия 2, отдельным чанком.

### 5.4. Конфигуратор сетапа (R2)

- 9 шагов (комната → стол → мониторы и кронштейны → кресло → периферия → свет → акустика → кабели → декор), любой пропускается.
- 2D-план — SVG вид сверху в масштабе (1 px = 5 мм по умолчанию): опоры стола и зона, где нельзя ставить струбцину, мониторы со стойками, кресло и зона отката, окно, розетки. Нарушение `checkSetup` — красная граница, фраза и кнопка замены. Без canvas и WebGL.
- Цвет корпуса ПК предлагает цвет стола, кресла и периферии; плата строк с монтажом — группа `mount`; полный цикл — от 13,3 млн.

### 5.5. «Идеи»

- Карточка: превью, «Фото: @ник, с разрешения автора. Сетап собран автором, не нами», теги, «Собрать похожий в Ташкенте» — только при разборе (Р-23).
- Скрипт Instagram — по нажатию (`omitscript=true`, ручной `instgrm.Embeds.process()`); CSP разрешает `instagram.com` только на страницах «Идей».
- Без разрешения — текстовая ссылка и описание своими словами. Отзыв — снятие публикации и перевыпуск сразу; задача контролирует срок 48 ч.

### 5.6. Сцена на прокрутке (R2)

```ts
// apps/web/components/scene/types.ts
export interface SceneAsset { posterAvif: string; posterWebp: string; video720: string; video1080: string; videoVertical720: string;
  frames: { src: string; alt: Localized; caption: Localized }[];   // 5 key frames, frames[0] = poster
  durationS: number; label: "visualization"; }
export type SceneMode = "video" | "sequence" | "static" | "path";   // path = HTML «Путь от заявки», no assets
export declare function chooseSceneMode(env: { reducedMotion: boolean; saveData: boolean; effectiveType?: string;
  deviceMemory?: number; userNoAnimation: boolean; hasAssets: boolean; canPlayH264: boolean }): SceneMode;
```

- Первый экран — постер `<img fetchpriority="high">` ≤ 150 КБ и HTML-текст: это LCP.
- Видео H.264 без звука, ключевой кадр каждые 8 кадров, `muted playsinline`, `preload="none"`; загрузка — после LCP и простоя или при подходе секции. Новое `currentTime` — только после `seeked`.
- GSAP ScrollTrigger — динамический импорт только на главной; Lenis — только `pointer: fine`; прокрутка не перехватывается; ссылка «Пропустить анимацию».
- `static` (5 кадров ≈ 630 КБ): `prefers-reduced-motion`, `saveData`, 2g/3g, `deviceMemory ≤ 2`, переключатель «Без анимации» (cookie). `sequence` — если замер на реальном Android покажет рывки.
- Медиа отдаёт Caddy из тома `media` с Range (206) и `immutable` для имён с хэшем. Каждый кадр подписан «visualizatsiya / визуализация».

### 5.7. Дизайн-токены и тема

- Тема одна — ночная «Ночная съёмка» (Р-18 от 06.10.2026, ADR-006): `<html data-theme="night">`; переключателя, выбора по времени и настройки темы в админке нет. Админка использует те же токены.
- Слой 1 — примитивы палитры nivel-1 (`--nv-asphalt #1D1D1B`, `--nv-signal #D9501A`, `--nv-signal-dark #F06A30`, `--nv-paper #F1EFEA`) и токены ночи из `docs/design/day-night/DESIGN_SYSTEM.md`. Источник в коде — `packages/ui/src/themes/tokens.ts`; `themes.css` генерируется из него (только переменные).
- Слой 2 — семантические токены: `--nv-bg`, `--nv-surface`, `--nv-surface-2`, `--nv-sheet`, `--nv-fg`, `--nv-fg-muted`, `--nv-line`, `--nv-accent`, `--nv-accent-ink` (текст, контраст ≥ 4,5:1), `--nv-on-accent`, `--nv-stamp`, `--nv-font-display`, `--nv-font-text`, `--nv-font-mono`, `--nv-radius` (0–2 px), шкала отступов, `--nv-gutter` (16 px на телефоне), `--nv-maxw`, `--nv-header-h`, `--nv-motion-fast`, `--nv-motion-base`.
- Документальные блоки из Б (смета со штампами, паспорт сборки) — «бумага» `.nv-paper` внутри ночной страницы и в PDF; цвета бумаги тоже в `tokens.ts`.
- Tailwind 4: `@theme inline { --color-bg: var(--nv-bg); ... }`; компоненты используют только семантику (`bg-bg text-fg border-line`).
- Пакет `@nivel/ui`: вход `.` — ядро без React (токены, шрифты, форматирование; грузится в чистом Node для worker и PDF), вход `./react` — примитивы и компоненты, `./styles.css`, `./themes.css`, `./fonts/*`.
- Шрифты — свои woff2 (OFL) через `next/font/local`; предзагружается одно начертание (Fira Sans 400), остальные `preload: false`, `display: "swap"` (спайк в ADR-006). Подмножества latin, latin-ext, cyrillic; тест проверяет глифы U+02BB и U+02BC в каждом файле. Manrope — только в SVG логотипа.
- `tools/check-antilist.mjs`: шрифты Geist, Inter, Onest, Source Serif 4 и Manrope вне логотипа; цвета анти-списка брифа; размытие (`filter: blur`, `backdrop-filter`); цветные свечения (`box-shadow` с цветным размытием); сырые HEX и `rgb()` вне файлов тем. Тест контраста пар токенов (WCAG 2.2 AA).

### 5.8. Производительность на Android среднего уровня

| Показатель | Бюджет (p75, телефон) |
| --- | --- |
| LCP / INP / CLS | ≤ 2,5 с / ≤ 200 мс / ≤ 0,1 |
| JS первой загрузки (gzip) | главная без сцены ≤ 150 КБ; конфигуратор ≤ 180 КБ |
| Главная целиком | ≤ 3 МБ без сцены; сцена ≤ 8 МБ (720p), после LCP |
| Постер / кадры | ≤ 150 КБ / ≤ 120 КБ каждый |
| Шрифты | ≤ 3 начертания на страницу, `display: swap`, предзагрузка одного |

- Серверные компоненты по умолчанию; клиентские — конфигуратор, сцена, чат, форма заявки, меню.
- Проверка: `tools/check-bundle-budget.mjs` по выводу `next build` (размер первой загрузки по маршрутам); Playwright на профиле Pixel 7 с замедлением ЦП ×4; итог — на реальных Redmi или Galaxy A и iPhone 12–13 (Р-19). Web Vitals — события Umami.
- Сторонних скриптов на старте нет: Umami со своего сервера, Instagram — по нажатию, Turnstile — только перед чатом ИИ.

## 6. Админка владельца (`apps/admin`)

### 6.1. Доступ и роли

- Отдельное приложение Next.js на `admin.nivel.uz`; Caddy пускает только адреса WireGuard `10.66.0.0/24`. Сертификат — Let's Encrypt HTTP-01 на публичном 80-м порту.
- Вход: e-mail + пароль (argon2id, от 14 знаков) + TOTP; сессия — непрозрачный токен в cookie `__Host-nv_admin` (`Secure`, `HttpOnly`, `SameSite=Strict`), в БД — хэш; 8 ч бездействия; блокировка на 15 мин после 5 неудачных попыток; журнал входов. Коды восстановления TOTP — 10 одноразовых, хэшированы.
- Роли:

| Роль | Может | Не может |
| --- | --- | --- |
| `owner` | всё | удалять платежи, наблюдения цен, согласия, журнал (не может никто) |
| `assistant` | заявки, закупки (запись чеков, фото, серийные номера), сборка и тесты, паспорт, гарантийные случаи | денежные события, настройки денег и правил, отправка сметы, отчёт, отмена, юридические тексты, выгрузка клиентов |
| `translator` | локализованные поля страниц, FAQ, `policy_texts`, глоссарий, разборы «Идей» | каталог, цены, заказы, клиенты, публикация юридических текстов |
| `accountant` (позже) | чтение реестров, выгрузки CSV | изменения |

- Интерфейс — русский; документы клиента — uz и ru. Мобильная вёрстка: фото чеков с телефона (`<input type="file" accept="image/*" capture="environment">`), снятие EXIF через sharp.
- Каждое серверное действие проверяет роль (`requireRole`) и пишет `ops.audit_log`.

### 6.2. Набор экранов `admin kit`

```ts
// apps/admin/src/kit/resource.ts
export interface ResourceDef<T extends z.ZodTypeAny> {
  name: string; title: string; table: AnyPgTable; schema: T;                 // zod drives the form
  list: { columns: (keyof z.infer<T>)[]; filters?: FilterDef[]; defaultSort?: string };
  form?: { groups?: FieldGroup[]; hidden?: string[]; conditional?: Record<string, (v: z.infer<T>) => boolean> };
  localized?: (keyof z.infer<T>)[];   // rendered as uz/ru tabs, uz required to publish
  files?: FileFieldDef[]; references?: ReferenceDef[];
  status?: { field: string; publishGuard?: (v: z.infer<T>) => string | null };  // draft → verified/published
  roles: { read: Role[]; write: Role[] }; audit: true;
}
export declare function defineResource<T extends z.ZodTypeAny>(def: ResourceDef<T>): Resource<T>;
```

- Из zod строятся список с фильтрами и страницами, форма (строка, число, перечисление, флаг, дата, `Localized` вкладками uz/ru, массив, вложенный объект, файл, ссылка с поиском), валидация на сервере, история изменений из `ops.audit_log` с восстановлением прошлой версии для контента.
- Характеристики позиции — подформа по категории (`ProductSpecs` из `contracts`), условный показ групп.
- Импорт CSV для любого ресурса с построчными ошибками и предпросмотром.
- На наборе строятся каталог, продавцы, правила, контент, «Идеи», клиенты, настройки. Свои экраны — доска заказов, смета, закупки, отчёт, порог, импорт прайсов.

### 6.3. Разделы

| Раздел | Что делает | Выпуск |
| --- | --- | --- |
| Сводка | Заявки без ответа (таймер), сметы с истекающим сроком, отчёты к сдаче (24/48 ч), возвраты (5 р. д.), ЭСФ к подписи (10 дней), гарантийные сроки, порог (60–100 %), расход ИИ | R0 |
| Заявки и заказы | Доска по статусам; карточка: хронология, смета, платежи по видам, закупки с фото чеков, отчёт комиссионера, акты, паспорт, гарантия; кнопки — только разрешённые автоматом, отказ — текст `GuardError` | R0 |
| Смета | Строки из каталога (медиана на дату, доверие) или вручную; замена, «свои детали»; итоги `computeQuote` при каждом изменении; совместимость; отметка «проверено вручную»; «Отправить» (PDF uz/ru + бот) | R0 |
| Закупки | Строка сметы → чек: сумма, продавец, способ, фото, ЭСФ и срок, серийные номера, гарантия продавца, подлинность; индикатор «потрачено / лимит / получено» | R0 |
| Каталог | R0 — импорт CSV и общая форма; R1 — полные экраны по категориям, дубли, аналоги, «кто внёс — кто проверил», статусы черновик/проверено/снято | R0 → R1 |
| Цены | Ручной ввод наблюдения, импорт CSV с предпросмотром; R1 — опубликованная Google Таблица, очередь сопоставления (`sku_mappings`), медианы, исключённые выбросы, курс ЦБ и история | R0 → R1 |
| Правила подбора | Лестницы, 32 шаблона, границы, пороги проверок; черновик → прогон эталонных сборок → публикация версии | R1 |
| Документы | Версии оферты и политик (заглушка → проверено юристом → опубликовано); PDF по заказу | R0 |
| Порог и учёт | Реестр «поступило = закуплено + возвращено» по заказам; сделки года против порога и плана; доход другой деятельности ИП; резервы; выгрузка CSV для бухгалтера | R0 |
| Настройки | Шкала платы с датой действия, резервы, сроки смет, календарь и праздники, часы ответа, тема сайта, флаги, лимиты и выключатель ИИ | R0 (деньги, календарь) → R2 (ИИ) |
| Журнал | Аудит цен, правил, денег, входов | R0 |
| Контент и «Идеи» | Страницы, FAQ, `policy_texts`, глоссарий, «Идеи» с разрешениями и сроком снятия, портфолио, медиа с пометками | R1 |
| Клиенты и ПД | Карточки, согласия, запросы субъектов (30 дней), выгрузка JSON, обезличивание | R1 |

### 6.4. Документы PDF (`packages/pdf`)

- `@react-pdf/renderer` 4.9.0; шрифты TTF в пакете (Fira Sans, IBM Plex Mono — OFL; глифы U+02BB/U+02BC проверяются тестом); стиль документа — палитра nivel-1, не зависит от темы сайта. Рендер — задача worker, файл — `ops.files` (`retention_class` по типу), ссылка — в карточке и в боте.
- Пока документ опирается на текст `stub`, в PDF — водяной знак «QORALAMA / ЧЕРНОВИК — не для подписи».
- Смета: позиции, продавец-ориентир (если можно называть), цена и дата, курс, срок действия, лимит закупки, две строки платы, этапы 30/70, реквизиты счёта ИП с назначением «средства комитента на закупку по договору № … Без НДС», позиции без возврата с отдельным согласием. Номер личной карты запрещён в шаблонах (тест).
- Отчёт комиссионера (п. 28 Положения ПКМ № 489): позиции, чеки и ЭСФ, серийные номера, гарантии, скидки и бонусы (клиенту), получено — потрачено — остаток, срок возражений 3 рабочих дня.
- Акты: приём материала заказчика с ценами по чекам (ГК ст. 661), приём своих деталей клиента, сдача. Паспорт сборки: серийные номера, BIOS, ОС, тесты и температуры, фото, гарантия до даты, QR. Гарантийный талон.

### 6.5. Импорт цен

- CSV (шаблон блока 08, 6.4) → построчная валидация zod → сопоставление по `sku_mappings`, MPN, EAN, затем trigram-подсказки → предпросмотр «сопоставлено / новое / ошибки» → подтверждение → `price_observations` → задача пересчёта медиан.
- Google Таблица (R1): продавец публикует лист как CSV; worker забирает раз в сутки; смена структуры — ошибка импорта и сообщение владельцу. Ключей Google нет.
- XLSX — через `exceljs` в R1; в R0 владелец сохраняет CSV.

## 7. Telegram-бот (`apps/bot`)

### 7.1. Устройство

- grammY 1.46.0, `@grammyjs/auto-retry`; сессии — `bot.sessions` (адаптер на Drizzle); шаги диалога — свой автомат в сессии (без плагина `conversations`); переводы — `packages/i18n` через `createTranslator`.
- `BOT_MODE=polling` в R0 (`@grammyjs/runner`, без публичного адреса); `webhook` — `https://nivel.uz/tg/<случайный-путь>` через Caddy, проверка `X-Telegram-Bot-Api-Secret-Token`, `allowed_updates` — только нужные, ответ сразу, тяжёлое — в pg-boss. Идемпотентность — `bot.processed_updates`.
- Бот игнорирует группы, кроме группы владельца (id в настройках); в группе принимает команды только от `TELEGRAM_OWNER_IDS` и помощника.
- Исходящие — через `ops.outbox` с троттлингом: 1 сообщение/с на чат, 20/мин на группу, 25/с всего. `callback_data` — латинские идентификаторы `o:NV-2026-0001:ack` ≤ 64 байт.
- Бот вызывает `services` напрямую (не HTTP к сайту); цена и совместимость — `domain`.

### 7.2. Сценарии R0

| Сценарий | Шаги |
| --- | --- |
| Старт и язык | `/start` → «Oʻzbekcha / Русский» (узбекский первым); язык — в профиле, на `language_code` не полагаемся; `setMyCommands` и описания на обоих языках |
| Согласие | короткое уведомление, ссылка на политику (версия), кнопка «Roziman / Согласен» → `ops.consents`; без согласия контакт не запрашивается |
| Подбор кнопками | задача → бюджет (диапазоны в сумах) → состав (только ПК / ПК и периферия / сетап) → пожелания (тишина, размер, подсветка, цвет) → 1–3 сборки: в R0 — витринные шаблоны `base_builds` по задаче, уровню и стилю; цена — медиана на дату или «уточняется мастером»; в R1 — `domain.autobuild`. Пометка «ориентир, не оферта»; демо — плашка (только не в production) |
| Заявка | итог подбора или ссылка `/s/{code}` → «Поделиться контактом» → район (не адрес) → срок → `services.leads.create` → номер и срок ответа из `policy_texts`; лимит 3 заявки в сутки |
| Группа владельца | новая заявка → `createForumTopic("L-2026-0007 · Chilonzor · ПК 15 млн")` → карточка с кнопками (события автомата по роли); ответ владельца в теме копируется клиенту (`copyMessage`); строки с префиксом `//` клиенту не уходят; адрес — по кнопке из базы |
| Смета и акцепт | PDF сметы на языке клиента, срок, две строки платы, лимит закупки → «Принять оферту и смету» → согласия → `ACCEPT`; при неопубликованной оферте кнопки нет, текст «акцепт после публикации оферты» |
| Оплата | плата 30 % — QR Xolis и инструкция; деньги на закупку — реквизиты счёта ИП и готовое назначение; поступление подтверждает владелец |
| Фото чеков | владелец загружает чек в админке или фото в тему с подписью `1250000 Mycom` → бот предлагает строку сметы → черновик закупки → подтверждение кнопкой → фото клиенту |
| Отчёт и акт | PDF отчёта с кнопками «Tasdiqlayman / Подтверждаю» и «Savol bor / Есть вопрос» (3 рабочих дня); акт сдачи и паспорт; кнопка «Qabul qildim / Принял» фиксирует время, id сообщения и пользователя (сила кнопки — вопрос юристу; запасной путь — фото бумажного акта) |
| Автоответ | вне пн–сб 10:00–19:00 (Ташкент, праздники) — часы работы и срок ответа; напоминание владельцу «нет ответа 15 минут» — только в часы ответа |
| Гарантия | «Muammo haqida xabar berish / Сообщить о проблеме» → описание и фото → `warranty_cases` с точным временем → тема владельцу |
| Команды | `/start`, `/language`, `/order`, `/support`, `/terms`, `/privacy`, `/stop` |
| Сводка | 09:30 в группе: новые заявки, просрочки (смета, отчёт, возврат, ЭСФ, гарантия), порог; оповещения 60/70/80/90 % |

### 7.3. Mini App (V1)

- Маршрут `/tma` сайта: конфигуратор в облегчённом режиме, карточка заказа, принятие сметы; запуск — меню бота и `t.me/niveluzbot/app?startapp=cfg_<code>|order_<number>|idea_<id>`.
- Проверка `initData` в `packages/telegram/initData.ts` (`node:crypto`): строка — поля кроме `hash` по алфавиту через `\n`; `secret = HMAC_SHA256(key="WebAppData", msg=botToken)`; сравнение `hash` с постоянным временем; `auth_date` ≤ 24 ч для просмотра и ≤ 1 ч для заявки и акцепта. `initDataUnsafe` не используется.
- После проверки — токен `jose` на 1 ч в памяти страницы, заголовок `Authorization`; без cookie (cookie третьих сторон в WebView ненадёжны).
- Тема Telegram — только фон и текст системных элементов поверх семантических токенов.

### 7.4. Рассылки

- Отдельная кнопка «Получать новости и подборки» → `ops.consents(kind=marketing)` + `bot.subscriptions`; в каждом сообщении — «Отписаться»; не чаще 2 раз в месяц; журнал. Сервисные сообщения по заказу — без отдельного согласия. Рассылки — этап 2, модель данных — с R0.

## 8. ИИ-консультант (`packages/ai`, пилот)

### 8.1. Включение и режимы

| Режим | Когда | Что работает |
| --- | --- | --- |
| Выключен (по умолчанию) | нет `ANTHROPIC_API_KEY`, или `AI_ENABLED=false`, или флаг `feature.ai` выключен | «Подбор за 5 шагов», ответы из `policy_texts`, «Спросить человека» |
| Полный | ключ и флаг есть, бюджет < 80 % | модель из настроек (`claude-opus-5-5`), `output_config.effort: "low"` задаётся явно |
| Экономный | ≥ 80 % месячного бюджета или дневной лимит | новые диалоги — `claude-sonnet-5-5`, `effort: "low"`; начатые — на прежней модели |
| Без ИИ (авто) | 100 % бюджета; 400 при лимите расходов; 429 `enforced_spend_limit_reached`; 401; 3 сбоя подряд | как «Выключен»; оповещение владельцу |

- Пилот (Р-21): Opus 5.5 low против Sonnet 5.5 на 83 диалогах (41 узбекский) по 8 критериям блока 26; лимит 50 $; прогон тратит деньги — только с согласия владельца (`pnpm ai:eval`).
- Каналы: сайт — R2; бот — V1.

### 8.2. Запрос (SDK 0.131.0)

```ts
// packages/ai/src/run-turn.ts (sketch)
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
const stream = client.messages.stream({
  model: conv.model,                                // fixed per conversation
  max_tokens: 2_000,
  output_config: { effort: "low" },                 // Opus 5.5 default is medium
  system: [{ type: "text", text: SYSTEM_PROMPT[conv.lang],   // frozen: no dates, no user data
    cache_control: { type: "ephemeral", ttl: conv.channel === "telegram" ? "1h" : "5m" } }],
  tools: TOOLS,                                     // frozen per deployment, strict, additionalProperties: false
  tool_choice: { type: "auto" },                    // forced tool choice → 400 on Opus 5.5 / Sonnet 5.5
  messages: conv.history,                           // append-only
});
const msg = await stream.finalMessage();
```

- Свой цикл инструментов (не Tool Runner): ≤ 4 вызовов на реплику, ≤ 30 запросов на диалог; все `tool_result` одного хода — одним сообщением; ошибка инструмента — `is_error: true`.
- Thinking у Opus 5.5 не выключается: параметр `thinking` не передаём, глубину задаёт `effort`.
- История только дописывается (аккаунт после 31.08.2026 — правка истории даёт 400): ответы модели возвращаются без изменений; смена языка — системным сообщением в конце; подмена ответа шаблоном — только в показе, в историю — системная пометка; смена модели — только для новых диалогов. Тест в CI на неизменность префикса.
- `stop_reason: "refusal"` — шаблон «уточните вопрос» и «Спросить человека». Серверный `fallbacks: "default"` — флаг в настройках после пилота (другая модель отбрасывает рассуждение и кэш).
- Ошибки по классам SDK: `AuthenticationError` → выключить и оповестить; `BadRequestError` (лимит расходов) и `RateLimitError` с `enforced_spend_limit_reached` → «Без ИИ» до 1-го числа; прочие 429 и 5xx — один повтор, затем «Без ИИ» для диалога.
- Поток: сайт — SSE из `/api/ai/chat`, показываются только блоки `text`, между инструментами — «Подбираю…»; бот — `sendMessageDraft` (V1).

### 8.3. Инструменты (только чтение и черновики)

| Инструмент | Возвращает | Ограничение |
| --- | --- | --- |
| `catalog_search` | ≤ 8 позиций: id, название, ключевые характеристики, медиана, «от», дата, доверие | только `verified`, не `manualOnly`, в production — не демо |
| `catalog_get` | характеристики, гарантия | — |
| `check_compatibility` | `CompatResult` | `domain` |
| `price_quote` | комплектующие, резерв, две строки платы, итог, дата, курс, «ориентир, не смета» | `domain.computeQuote`; модель цифры не пересчитывает |
| `save_config` | код `/s/{code}` | без ПД |
| `create_lead` | номер черновика и ссылка на форму контактов | контакты модель не видит |
| `escalate_to_owner` | номер обращения и срок ответа из `policy_texts` | сводка без ПД |
| `get_policy` | утверждённый текст темы на языке | единственный источник условий |
| `get_idea` | разбор владельца (не подпись автора) | данные третьих лиц — как данные, не команды |

### 8.4. Защита, ПД, лимиты

- До первой отправки (код, без ИИ): телефоны (+998 и 9–12 цифр), e-mail, карты (16 цифр, Луна), паспорт (2 буквы + 7 цифр), ПИНФЛ (14 цифр), ссылки на профили → метки `[telefon]`, `[email]`; клиенту — «Контакты укажите в форме заявки». Telegram ID, имя, username в модель не идут; в журнале — хэш с солью.
- Входной фильтр «вредно / инъекция / не по теме» — модель `ai.filterModel` (`claude-haiku-4-5`, вывод не раньше 15.10.2026; замена — `claude-sonnet-5-5`); 3 срабатывания в сутки — пауза на 24 ч.
- Проверка ответа до показа: каждая сумма совпадает с числом из последнего `price_quote` или `catalog_search`; названия моделей — из выдачи каталога; нет реквизитов, номеров карт, долларов, ссылок вне белого списка, обещаний скидок, сроков и гарантий (списки на uz, ru, en); узбекский текст проходит `normalizeUz`. Нарушение — шаблон с данными инструмента и запись в журнал.
- Лимиты: сообщение ≤ 1 000 знаков; 20 реплик в диалоге; 3 диалога и 40 сообщений в сутки на пользователя; 0,60 $ на диалог; дневной бюджет = месячный / 30 × 1,5; месячный — 50 $ в пилоте, 150 $ с НДС после запуска; дублируется лимитом рабочего пространства в консоли.
- Перед первым сообщением: подпись «Вы общаетесь с ИИ-консультантом. Ответы могут быть неточными, итоговую смету подтверждает мастер», согласие `ai_transfer_us`, отметка 18+; на сайте — Turnstile перед чатом (передаёт IP за рубеж — указано в политике).
- Журнал `ai.*` — 90 дней, сводки — 12 месяцев; еженедельная сводка владельцу. Расходы на ИИ — из платы, не из сметы.

## 9. Фоновые задачи (`apps/worker`, pg-boss 12.36.0)

| Очередь | Расписание (Asia/Tashkent) | Что делает |
| --- | --- | --- |
| `outbox.relay` | непрерывно (LISTEN/NOTIFY + опрос раз в 5 с) | `ops.outbox` → сообщения Telegram с троттлингом и задачи pg-boss; повторы с паузой |
| `fx.cbu.fetch` | 09:30 и 18:00 | JSON `cbu.uz/ru/arkhiv-kursov-valyut/json/` → при сбое XML → иначе последний курс с пометкой; `fx_rates`; изменение > 2 % и 2 сбоя подряд — оповещение |
| `prices.import.file` | по событию | разбор загруженного CSV, предпросмотр |
| `prices.import.apply` | по нажатию | запись `price_observations` партией |
| `prices.import.sheet` | 03:00 на продавца с таблицей (R1) | опубликованный CSV, валидация, наблюдения |
| `prices.recompute` | 04:00 и после импорта | медианы, выбросы, доверие → `market_prices`; рост шаблона > 10 % — оповещение; инвалидация тега `prices` |
| `prices.stale` | 10:00 | прайс партнёра старше 7 дней — напоминание; позиции → «цена уточняется» |
| `prices.scrape` | V1, ночью | только разрешённые сайты, 1 запрос в 10 с, свой User-Agent, стоп при 403/429/капче |
| `orders.estimate.expiry` | каждые 5 мин | `EXPIRE` по `validUntil` |
| `orders.reminders` | каждые 5 мин | заявка без ответа 15 мин (в часы ответа); неоплаченная смета 24 ч; отчёт 24/48 ч; `REPORT_DEEMED_ACCEPTED` по сроку; возврат остатка 5 р. д.; ЭСФ 10 дней; снятие поста «Идей» 48 ч |
| `warranty.sla` | каждые 15 мин | сроки гарантийных случаев |
| `warranty.vendor_expiry` | 09:00 | гарантия продавца кончается через 30 дней |
| `aftercare` | 10:00 | звонки через 7 и 30 дней, профилактика через 6–12 месяцев; срок зачёта «Подбора» читается из `orders.podbor_credit_until`, отдельной задачи нет (ADR-007) |
| `threshold.check` | 06:00 и после платежа или чека | `thresholdStatus`, оповещения, снимок раз в сутки |
| `pdf.render` | по событию | документы uz/ru → `ops.files` |
| `ideas.embed.check` | понедельник 08:00 (R1) | доступность постов через oEmbed |
| `retention.purge` | 03:30 | журналы ИИ > 90 дней; заявки без заказа > 12 мес.; сессии; `processed_updates` > 7 дней; файлы по классу хранения |
| `ops.selfcheck` | каждые 10 мин | возраст копии > 26 ч, диск > 80 %, сертификат < 14 дней, очередь стоит > 10 мин, `getWebhookInfo.last_error_date` (в режиме webhook) |
| `ops.error_digest` | 20:00 | сводка `ops.app_errors` |
| `ai.usage.rollup` | 00:10 (R2) | расход, экономный режим, недельный отчёт |

- Задачи идемпотентны (`singletonKey`), повторы с экспоненциальной паузой, после 5 неудач — `ops.app_errors` и оповещение.
- Регистрация задач — `apps/worker/src/jobs/<domain>/register.ts`; корневой список доменов заморожен (WP-00).
- Резервные копии — не в worker, а в контейнере `backup` (12.4): worker не получает ключей копий.

## 10. Безопасность, ПД, журналирование, наблюдаемость

### 10.1. Безопасность (OWASP Top 10:2025)

| Риск | Мера |
| --- | --- |
| A01 Доступ | Админка — WireGuard + пароль + TOTP; роль в каждом серверном действии; кабинет и Mini App — только свои заказы; роли БД с минимальными правами; приватные файлы (чеки, акты, паспорта) — подписанные ссылки на 10 мин |
| A02 Конфигурация | Наружу 80/443 и UDP 51820; Postgres без порта наружу; контейнеры не от root, `cap_drop: ALL`, `no-new-privileges`, файловая система только для чтения, где можно; CSP с nonce, HSTS, `frame-ancestors 'none'` (кроме `/tma`: `https://web.telegram.org`), `Referrer-Policy: strict-origin-when-cross-origin` |
| A03 Цепочка поставки | Точные версии в каталоге pnpm, `--frozen-lockfile`, `onlyBuiltDependencies`, `minimumReleaseAge`; `pnpm audit` еженедельно; исправления Next — за 48 ч; образы собираются вне сервера |
| A04 Криптография | TLS везде; argon2id; AES-256-GCM для паспортных данных («поручение») и секретов TOTP (`DATA_ENC_KEY`); копии шифрует restic |
| A05 Внедрение | Только параметризованные запросы Drizzle; zod на каждом входе; Markdown без сырого HTML |
| A06 Дизайн | Цена, плата, лимит и статус — только сервер (`domain`); денежные запреты — в `domain` и в базе; ИИ не пишет в базу, кроме черновиков |
| A07 Аутентификация | Блокировка после 5 попыток; ограничение частоты; `initData` с проверкой давности; одноразовые ссылки кабинета на 15 мин |
| A08 Целостность | Секрет вебхука; HMAC внутренней инвалидации; журналы только дописываются |
| A09 Журналы | Аудит входов, цен, правил, денег; оповещения в Telegram-чат «Nivel ops» |
| A10 Исключения | Ошибки наружу без деталей; при сбое ЦБ, Telegram, Anthropic — понятный режим без функции, доступ не расширяется |

- Ограничение частоты (rate-limiter-flexible, Postgres): заявки — 3 в сутки на телефон, Telegram ID и IP-хэш; расчёт — 60 в минуту на IP; вход в админку — 5 попыток; бот — 1 обновление в секунду от пользователя.
- Секреты — только в `.env` (в git — `.env.example`); на сервере `chmod 600`; копия — в менеджере паролей и зашифрованная `age` рядом с копиями базы (у владельца уже терялся `.env`); отдельные токены бота и ключи для разработки и прода; ротация раз в 6 месяцев.
- Переменные окружения проверяет zod-схема `packages/config/env.ts` при запуске; без обязательной переменной процесс не стартует.
- Проверка запуска в бою (`APP_MODE=production`): процесс не стартует, если в выдаче есть демо (`products.is_demo AND status='verified'`, `base_builds.is_demo AND is_showcase`, `market_prices.is_demo` в текущих ценах, `idea_posts.is_demo AND status='published'`). Оферта-заглушка запуск не блокирует (Р-25 разрешает заявки и сметы без акцепта), но автомат не пускает `ACCEPT`, а сайт и PDF показывают плашку.
- `gitleaks` (образ Docker, без сети) — в `pnpm ci:local` и перед коммитом.

### 10.2. ПД и согласия

- Карта данных `docs/arch/DATA-MAP.md`: что собираем, где храним (сервер в Ташкенте; зашифрованные копии — ЕС), кому передаём (Anthropic — текст чата без контактов, США; Telegram — сообщения бота; продавцы — ФИО и телефон только при талоне на имя клиента; Cloudflare — IP при Turnstile), сроки.
- Согласия — записи с версией документа, хэшем текста, языком, каналом, временем и доказательством; отзыв — новой записью; виды — 3.3.
- Сроки хранения (`ops.files.retention_class`): заявки без заказа — 12 месяцев; заказы, чеки, гарантия — до конца самой длинной гарантии + 3 года и не меньше 5 лет (налоговые документы); журнал ИИ — 90 дней; логи — 30 дней.
- Запросы субъектов — экран «Данные клиента»: выгрузка JSON, исправление, удаление с обезличиванием того, что нужно хранить по закону; срок 30 дней.
- Минимум ПД: в теме владельца — район; адрес — по кнопке и только владельцу; в ИИ — только очищенный текст; в логах — маски.
- Утечка: порядок «24 и 72 часа» — `infra/RUNBOOK-incident.md`; адресат уведомления — запросить в МВД до запуска (блок 04, 1.7).
- Cookie — только технические (язык, сессия, «без анимации»); Umami без cookie; пиксель Meta и лид-формы не используются; основной домен без проксирования Cloudflare.

### 10.3. Журналирование и наблюдаемость

- pino JSON в stdout; `redact`: `phone`, `name`, `address`, `passport`, `initData`, `authorization`, `cookie`; Docker `json-file` с ротацией 10 МБ × 5.
- Корреляция: `X-Request-Id` от Caddy проходит через web, admin, services и задачи.
- Ошибки — `ops.app_errors` по отпечатку + вечерняя сводка; критичные — сразу в «Nivel ops».
- `/healthz` у каждого приложения: БД, очередь, возраст курса ЦБ (< 48 ч).
- Оповещения: 5xx > 10 за 5 мин, задача упала 3 раза, копия старше 26 ч, проверка восстановления не прошла, диск > 80 %, сертификат < 14 дней, ошибки вебхука, ИИ на 80 и 100 %, порог.
- Внешняя проверка доступности — со второй площадки (решение владельца). Бизнес-метрики — события Umami без ПД; ИИ — `ai.usage_daily`.

## 11. Локальная разработка и тесты

### 11.1. Окружение Windows

- Установить один раз: `npm i -g pnpm@12.9.1`; дальше `pnpm install` сам скачивает Node 24.21.0 (1.2). Docker Desktop — есть; Python для проекта не нужен.
- `infra/compose.dev.yml` (`name: nivel-dev`): только `postgres:18.6-trixie`, контейнер `nivel-dev-pg`, `127.0.0.1:54329`, том `nivel-dev-pgdata`, `mem_limit: 512m`, init-скрипт ролей и баз (`nivel`, `nivel_umami`).
- `infra/compose.test.yml` (`name: nivel-test`): `nivel-test-pg`, `127.0.0.1:54339`, данные в `tmpfs`, `fsync=off`, `mem_limit: 512m`.
- Приложения — на хосте (быстрее отслеживание файлов, меньше памяти Docker Desktop):

| Сервис | Порт (слот 0) |
| --- | --- |
| web | 3100 |
| admin | 3101 |
| worker (health) | 3102 |
| bot (health и вебхук, если включён) | 3103 |
| Umami (профиль `analytics`) | 3110 |
| Postgres разработки / тестов | 54329 / 54339 |

- Worktree со слотом N — порты `3100 + 100 × N …` (2.3).
- Чужие контейнеры и порты не трогать: gas-platform (8081, 8010), ai-fin-consultant (8091, 8092, 5433), прочие (8095, 8480, 8443). Команды Docker — только с `-p nivel-dev` / `-p nivel-test`; `docker system prune`, `docker volume prune` и `docker compose down` без проекта запрещены (правило в `CLAUDE.md` проекта).
- Бот разработки — отдельный токен (`@nivel_dev_bot`, создаёт владелец), `BOT_MODE=polling`. Без токена бот пишет «disabled: no BOT_TOKEN» и не падает.
- Команды: `pnpm dev` (все 4 приложения), `pnpm infra:dev:up|down`, `pnpm db:migrate`, `pnpm db:seed:demo`, `pnpm db:reset`, `pnpm test`, `pnpm test:int`, `pnpm e2e`, `pnpm ci:local`, `pnpm i18n:export|import`.

### 11.2. Уровни тестов

| Уровень | Инструмент | Что проверяет |
| --- | --- | --- |
| Модульные | vitest 5.0.3 + fast-check | `domain`: каждое правило совместимости («нельзя», «проверьте», «нет данных»), мощность БП, медиана и выбросы (RX 550 за 39 млн), курс, шкала платы (таблица CONCEPT 1.2), граница 20 млн, 30/70 = плата, резервы, отказ по пяти точкам, «Подбор», порог (2026 при 15.10 и 01.11), автомат (каждый переход и каждый запрет, включая роль помощника и оферту), календарь через воскресенье и праздник, `normalizeUz`. Покрытие ≥ 90 % (деньги ≥ 95 %) |
| Эталонные сборки | vitest, снимки | 32 шаблона блока 28 без «нельзя»; набор заведомо несовместимых сборок падает с ожидаемыми правилами; «не предлагаем» в 8 клетках |
| Интеграция | vitest + Postgres 54339 | Миграции с нуля; триггеры (только дописывание, сверка, лимит закупки, CHECK платежей, статус только через `dispatch`); таблица денежных случаев против базы; репозитории; сценарий «заявка → смета → акцепт → 30 % → деньги → закупка → отчёт → возврат → акт → 70 % → закрытие»; задачи worker на фальшивых часах |
| Бот | vitest + перехват Bot API (`bot.api.config.use`) и MSW | язык, подбор, заявка, тема, копирование ответа, автоответ вне часов, `callback_data` ≤ 64 байт, нет номера карты в шаблонах |
| ИИ | vitest + MSW с записанными ответами | цикл инструментов, очистка ПД, проверка сумм, режимы при 400/429/401, неизменность истории, 12 атак блока 18 |
| e2e | Playwright 1.63.0 против `next start` на тестовой базе | сайт uz/ru: заявка, документы с плашкой заглушки, hreflang, конфигуратор на профиле Pixel 7; админка: вход с TOTP, блокировка, заказ от сметы до сдачи с загрузкой чека, запреты (закупка сверх лимита, «закупка через QR»), помощник без денежных кнопок |
| Статические | `tools/check-*.mjs` | типы, Biome, зависимости пакетов, владение файлами, анти-список, апострофы uz, ключи сообщений, бюджет JS, демо в production, версия Node |

### 11.3. Защита стенда и сети в тестах

- Тестовая настройка (`packages/testing/src/db.ts`) переопределяет все `DATABASE_URL_*` сразу на тестовую базу и отказывается работать, если имя базы не оканчивается на `_test`, порт — 54329 или хост не `127.0.0.1`.
- Каждый воркер vitest — своя база из шаблона: `CREATE DATABASE nivel_s<slot>_w<worker>_test TEMPLATE nivel_s<slot>_template_test`; шаблон пересоздаётся при изменении миграций (хэш папки).
- `NETWORK_GUARD=1`: любой неперехваченный исходящий запрос в тестах — ошибка; ЦБ, Telegram, Anthropic, Instagram — MSW; Playwright блокирует всё, кроме localhost.

### 11.4. CI

- `pnpm ci:local` (работает без GitHub): `check-node` → установка `--frozen-lockfile` → `biome check` → `check-deps`, `check-ownership`, `check-antilist`, `check-uz-text`, `check-messages` → `tsc -b` → unit → тестовая БД и миграции → интеграция → сборка web и admin → `check-bundle-budget` → Playwright → `gitleaks`. Цель — ≤ 15 минут.
- GitHub Actions — после подключения приватного репозитория (Р-15): тот же скрипт на `ubuntu-latest`, Node из `devEngines`, сервис `postgres:18.6`; образы — в приватный GHCR только из `main`. Секретов в CI нет.

## 12. Развёртывание

### 12.1. Состав на VPS (2 ядра, 4 ГБ, диск ≥ 80 ГБ: Eskiz VPS 3 или UzCloud Basic)

| Сервис | Образ | Память (лимит) | Сеть |
| --- | --- | --- | --- |
| caddy | `caddy:2.11.6-alpine` | 64 МБ | 80/443 наружу; `admin.nivel.uz` — только 10.66.0.0/24 |
| web | `nivel-app:<tag>` команда `web` | 512 МБ | внутренняя |
| admin | `nivel-app:<tag>` команда `admin` | 384 МБ | внутренняя |
| bot | `nivel-app:<tag>` команда `bot` | 192 МБ | внутренняя |
| worker | `nivel-app:<tag>` команда `worker` | 384 МБ (PDF) | внутренняя |
| migrate | `nivel-app:<tag>` команда `migrate` (роль `nivel_migrator`) | разовый | внутренняя |
| postgres | `postgres:18.6-trixie` | 768 МБ (`shared_buffers=256MB`) | без порта наружу |
| umami | `ghcr.io/umami-software/umami` v3.4.0, профиль `analytics` | 320 МБ | внутренняя |
| backup | `postgres:18.6-trixie` + restic 0.19.1 + age + supercronic | 256 МБ | исходящий HTTPS к B2 |
| WireGuard | модуль ядра хоста | — | UDP 51820 |

- Итого лимиты ≈ 2,9 ГБ; swap 2 ГБ. Лимит бота и web подтвердить замером в WP-17.
- Один образ на четыре команды: многоэтапный `infra/docker/app.Dockerfile` на `node:24.21.0-trixie-slim` — `pnpm install --frozen-lockfile` → `next build` (standalone) web и admin → `pnpm deploy --prod` bot и worker → итоговый слой от пользователя `node`, шрифты PDF внутри. Цель — ≤ 450 МБ.
- Сборка на VPS запрещена: образы собирает CI (GHCR) или машина владельца (`docker save | zstd` → `scp` → `docker load`, скрипт `infra/ship.ps1`) до появления GitHub.

### 12.2. Домены и HTTPS

- `nivel.uz` — сайт, медиа, вебхук бота; `www` и `niveluz.com` — редирект; `admin.nivel.uz` — админка через WireGuard. DNS без проксирования Cloudflare.
- Caddy получает и продлевает Let's Encrypt сам; HSTS (`preload` — по решению владельца после недели без ошибок); HTTP → HTTPS; `zstd`/`gzip`; Range для медиа; заголовки безопасности.
- Маршруты Caddy: `/tg/<путь>` → `bot:3001`; `/media/*` → том `media` с `immutable`; `/api/internal/*` — 404 снаружи; остальное → `web:3000`.

### 12.3. Выпуск и откат

- `infra/deploy.sh <tag>`: загрузка образа → `docker compose run --rm migrate` → поочерёдный перезапуск `web admin bot worker` → `/healthz` → при сбое возврат на прошлый тег; переустановка вебхука при смене пути.
- Миграции — только «расширить, затем сузить»: новая версия работает со старой схемой; удаление столбцов — отдельным выпуском; откат — прошлый образ без отката схемы.
- Обновления: исправления безопасности Next — за 48 ч; ежемесячно — минорные Postgres и Caddy; мажор Postgres — dump/restore по runbook; ОС — `unattended-upgrades`.
- Тестовый стенд — на этапе роста; до него — проверка выпуска на машине разработки через `compose.prod.yml` с `-p nivel-prodcheck` и портом 3100.

### 12.4. Копии и проверка восстановления

- Ночью 02:00: `pg_dump -Fc` (основная база и Umami) → restic в два репозитория: хранилище в РУз (провайдер VPS или локальный диск) и Backblaze B2 в ЕС. Тома `files` (чеки, PDF) и `media` — тем же restic, инкрементально. Хранение: 14 ежедневных, 8 еженедельных, 12 ежемесячных.
- `.env` — копия, зашифрованная `age` (открытый ключ на сервере, закрытый — только у владельца), рядом с копиями; обновляется при каждом изменении.
- Еженедельно (воскресенье 05:00): контейнер `backup` поднимает временный кластер (`initdb` на tmpfs внутри своего контейнера, без Docker-сокета), восстанавливает последнюю копию, сверяет число строк ключевых таблиц (`orders`, `payments`, `purchases`, `commission_reports`, `consents`, `products`, `price_observations`) с манифестом копии, проверяет, что restic видит вчерашний снимок файлов, удаляет кластер, пишет итог в «Nivel ops».
- Ежеквартально — ручное восстановление всего сервиса на чистом VPS по `infra/RUNBOOK-restore.md`: сервер → Docker → `.env` из `age`-копии → база → файлы → `docker compose up`; цель ≤ 2 ч; время — в журнал.
- RPO 24 ч принят для R0–R1 (4–6 заказов в месяц; история дублируется в Telegram и PDF). WAL-G 3.0.9 (непрерывный архив в B2) включается, если владелец сочтёт RPO 24 ч неприемлемым для денежных данных или при > 20 заказах в месяц.
- Код: приватный GitHub после создания репозитория владельцем; еженедельный `git bundle` — `tools/git-bundle.ps1` в Планировщике Windows → restic → B2.

## 14. Риски архитектуры

| Риск | Вероятность | Влияние | Как снять |
| --- | --- | --- | --- |
| Своя админка дольше плана (40–60 ч против 3–6 недель блока 17); срок R0 — 02.11 | Средняя | Высокое | `admin kit` первым в WP-10; объём R0 заморожен (6.3); каталог R0 — CSV и общая форма; остальное — R1 |
| Боту в R0 нужен каталог и цены, а экраны каталога — в R1 | Высокая | Среднее | R0-подбор — витринные шаблоны по классам цен; цена — медиана, иначе «уточняется мастером»; импорт CSV и ручные цены — в R0 |
| Своя аутентификация (argon2, TOTP, сессии, блокировка) | Средняя | Высокое | WireGuard — основной барьер; готовые библиотеки; e2e блокировки, истечения сессии, кодов восстановления |
| Две линии денежных запретов (domain и база) разойдутся | Средняя | Высокое | Одна таблица случаев гоняется против обеих (3.4) |
| `devEngines.runtime` pnpm поведёт себя иначе на Windows | Низкая | Среднее | Спайк в WP-00; запасной путь — `fnm exec --using=.node-version`; `check-node` в `ci:local` |
| Параллельные worktree занимают порты и тестовые базы | Высокая без мер | Среднее | `NIVEL_SLOT`, префиксы баз, `check-ports`, ≤ 5 агентов одновременно, лимиты памяти Docker |
| Денежные правила, зависящие от юриста и налоговой (85 %, доли строк, чек на деньги на закупку, лимиты переводов на счёт ИП) | Средняя | Среднее | Все ставки и доли — `ops.settings` с версией и датой; формулы — в одном пакете с тестами; боевой приём денег — только после оферты и ответов |
| Демо-данные в бою | Средняя | Высокое | `is_demo`, плашка, сид запрещён в production, проверка запуска (10.1), тест «нет демо в выдаче» в каждом выпуске |
| Заглушки юридических текстов уйдут как действующие | Средняя | Высокое | Статусы документов, водяной знак, `ACCEPT` только при опубликованной оферте uz и ru |
| Ошибка платы или округления | Низкая | Высокое | Целые сумы, `floor`, `splitByShares`, fast-check, таблица CONCEPT 1.2 |
| Частые выпуски безопасности Next | Высокая | Высокое | Исправления за 48 ч, деплой одной командой, админка за WireGuard, `minimumReleaseAge` с исключением `next` |
| Ломающие обновления: Drizzle 1.0, React 19.4 против R3F 9.8, TypeScript 7, Node 26 LTS (28.10.2026) | Высокая в горизонте года | Среднее | Точные версии в каталоге pnpm; переходы — отдельными пакетами работ |
| Память VPS 4 ГБ | Средняя | Высокое | Лимиты контейнеров, swap, без Chromium, Umami по профилю, сборка вне сервера; рост — 4/8 ГБ |
| Один сервер — единая точка отказа | Средняя | Среднее | Копии в ЕС, runbook ≤ 2 ч, квартальная проверка; Telegram хранит обновления 24 ч |
| Потеря `.env` или ключа копий (уже было у владельца) | Средняя | Высокое | `age`-копия, менеджер паролей, восстановление `.env` — часть квартальной проверки |
| Ошибка правила совместимости пропустит несовместимую сборку | Средняя | Высокое | Два уровня, «нет данных» = «проверьте», ручная отметка перед сметой, эталонные сборки в CI |
| ИИ: оплата картой банка РУз, потолок нового аккаунта, качество узбекского, правка истории → 400 | Средняя | Среднее | Выключен по умолчанию; всё работает без ИИ; история только дописывается; пилот с 41 узбекским диалогом; лимиты в консоли и коде; план Б — Claude Platform on AWS |
| Переводчики не правят ICU JSON в админке | Высокая | Среднее | Поток XLSX `i18n:export/import` к заморозке 31.10 (Р-25); тексты в базе — роль `translator` |
| Сцена тормозит на бюджетных Android | Высокая | Среднее | Четыре режима, выбор до загрузки, замер на двух телефонах до вёрстки |
| Владелец не успевает проверять параллельные пакеты | Высокая | Высокое | Еженедельная приёмка по чек-листу на демо-стенде с телефона; ≤ 5 пакетов одновременно |
| Instagram oEmbed перестанет работать | Средняя | Низкое | Превью и ссылка по умолчанию, еженедельная проверка |

## Решения для владельца

| Вопрос | Варианты | Рекомендация |
| --- | --- | --- |
| Основа архитектуры | «Лёгкий» с пересадками; Payload 3 | «Лёгкий» (раздел 0) |
| Node на машине | Оставить 25.9 глобально, проект на 24.21 через pnpm; поставить 24 глобально | Оставить 25.9; проект сам скачивает 24.21 |
| Пакетный менеджер | pnpm 12.9.1; npm workspaces | pnpm |
| Округление платы | Вниз до сума; до 1 000 сум | Вниз до сума (ставка не выходит за шкалу) |
| Округление резервов (гарантийного и налогового) | Вверх; вниз | Вверх: резерв — защитный фонд, недобор хуже лишней сотни сумов (решение интегратора 06.10.2026, ADR-007 п. 4) |
| Порог резерва 5 % | Доля памяти и SSD ≥ 25 %; ≥ 30 % | 25 %, пересмотр после 10 смет |
| Срок смешанной сметы | 24 ч; по строкам | 24 ч, если есть хоть одна не мебельная строка |
| Удержание при отказе после тестов | 85 %; 100 % | 85 % до заключения юриста |
| Доли строк платы | По этапам (50/50); иное | По этапам до юриста и бухгалтера |
| Бот в R0 | Длинный опрос; вебхук | Длинный опрос; вебхук — переменной |
| Копии | restic, RPO 24 ч; + WAL-G | restic; WAL-G — по решению владельца или при > 20 заказах в месяц |
| Направление дизайна | Б, А, В | Выбрать по макетам до 26.10.2026; до выбора сайт работает в теме Б |
| Серверный fallback ИИ | Включить; выключить | Решить после пилота |
| Внешний мониторинг | Второй маленький сервер; бесплатный сервис | Решить до MVP-1 |
