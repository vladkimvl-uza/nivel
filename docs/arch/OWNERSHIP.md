# Владение путями

Дата: 05.10.2026. Ведёт интегратор (WP-00). Основа — BUILD_PLAN раздел 5, ARCHITECTURE 2.3.

- У каждого файла один владелец. Ветка `wp/NN-<имя>` меняет только пути своего пакета; проверка — `pnpm check:ownership` (`tools/check-ownership.mjs` сравнивает `git diff --name-only main...HEAD` и незафиксированные изменения с глобами ниже).
- Всё, что не перечислено у пакетов, принадлежит интегратору: корневой `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json` и `tsconfig.json` пакетов и приложений, `packages/db/migrations/**`, `packages/db/src/schema/index.ts`, `docs/arch/**` (кроме `DATA-MAP.md`), `CLAUDE.md`, `tools/check-*.mjs` (кроме переданных), `infra/compose.dev.yml`, `infra/compose.test.yml`, `infra/postgres/init/**`.
- Нужна зависимость, колонка, ключ окружения или изменение контракта — заявка интегратору в описании ветки.
- Общие исключения для любой ветки `wp/NN-…`: свои фикстуры `packages/testing/fixtures/wp-NN/**`.
- Формат для скрипта: заголовок `## WP-NN`, строки `- \`глоб\``; `!` в начале глоба — исключение; `**` — любая глубина, `{a,b}` — варианты; `[locale]` и `(marketing)` — буквальные имена папок Next.js.

## Реестр пространств имён переводов

Правило для новых пространств сообщений (ARCHITECTURE 5.2); WP-00, 06.10.2026.

- Файлы `packages/i18n/messages/{uz,ru,meta}/<ns>.json` пишет пакет, которому пространство нужно. Глобы этих файлов в раздел пакета выше вносит интегратор по заявке из описания ветки (`docs/arch/**` — его зона), пока раздела нет — файлы относятся к ветке, где пространство появилось. `common` остаётся у WP-08.
- Регистрацию в `packages/i18n/src/catalog.ts` (импорты json и строки `uz`/`ru`) дописывает интегратор при слиянии ветки: ветка пакета этот файл не правит. Пока пространство не зарегистрировано, `repo-messages.test.ts` только предупреждает.
- Перед слиянием интегратор запускает тесты i18n с `NIVEL_STRICT_NAMESPACES=1` (`pnpm exec vitest run packages/i18n` в PowerShell: `$env:NIVEL_STRICT_NAMESPACES=1`): файл на диске без регистрации тогда — ошибка.
- Узбекские тексты нового пространства сдаются со статусом `draft` в `meta`; ключи, которые выдаёт код (например, `quote.*` из `computeQuote`), совпадают с ключами сообщений: `t(warning.key, warning.params)`.

## Замороженные контракты

Меняет только интегратор после ADR и метки `contract` (BUILD_PLAN 1.1, ARCHITECTURE 2.3).

- `packages/domain/src/**/types.ts`

## WP-00

Каркас, интегратор: любые пути.

- `**`

## WP-01

Деньги, плата, отказ, порог, резервы.

- `packages/domain/src/{money,fee,cancel,threshold,reserve}/**`
- `packages/testing/fixtures/money-cases.json`

## WP-02

Автомат заказа, гарантия, календарь, узбекский текст.

- `packages/domain/src/{order,warranty,calendar,text}/**`

## WP-03

Совместимость и мощность.

- `packages/domain/src/{compat,catalog}/**`
- `packages/contracts/src/catalog/**`

## WP-04

Рынок и курс.

- `packages/domain/src/market/**`

## WP-05

Автосборка.

- `packages/domain/src/autobuild/**`
- `packages/testing/golden/**`

## WP-06

База данных. Миграции генерирует интегратор.

- `packages/db/src/schema/{catalog,pricing,sales,content,ai,bot,ops}.ts`
- `packages/db/sql/**`
- `packages/db/src/repos/**`
- `packages/db/seed/**`
- `docs/arch/DATA-MAP.md`

## WP-07

Сценарии и outbox.

- `packages/services/src/{orders,leads,quotes,payments,purchases,reports,acts,configs,consents,threshold,outbox}/**`
- `packages/contracts/src/{orders,leads,payments,purchases}/**`

## WP-08

Переводы и поток переводчика.

- `packages/i18n/src/**`
- `packages/i18n/messages/{uz,ru,meta}/common.json`
- `packages/i18n/messages/{uz,ru,meta}/quote.json` (ключи предупреждений `computeQuote`; добавлено интегратором 06.10.2026)
- `packages/db/seed/glossary/**`
- `tools/{i18n-export,i18n-import,uz-new-latin,check-uz-text,check-messages}.mjs`
- `tools/__tests__/{check-uz-text,check-messages}.test.mjs`

## WP-09

Дизайн-токены, темы, шрифты, примитивы.

- `packages/ui/**`
- `!packages/ui/src/direction/**`
- `!packages/ui/{package.json,tsconfig.json}`
- `tools/check-antilist.mjs`
- `tools/__tests__/check-antilist.test.mjs`
- `e2e/ui-*.spec.ts` (снимки ночной темы и движения логотипа; добавлено интегратором 06.10.2026)

## WP-10

Админка: основа, вход, admin kit, настройки. После R0 `(catalog)` переходит к WP-18.

- `apps/admin/app/{layout.tsx,(auth),(settings),(journal),(catalog)}/**`
- `apps/admin/src/{kit,auth,nav}/**`
- `e2e/admin-*.spec.ts` (вход с TOTP, блокировка, роли; добавлено интегратором 06.10.2026)

## WP-11

Админка: заказы, смета, платежи, закупки, отчёт, порог.

- `apps/admin/app/{(dashboard),(leads),(orders),(registry)}/**`
- `apps/admin/src/orders/**`

## WP-12

PDF-документы.

- `packages/pdf/**`
- `!packages/pdf/{package.json,tsconfig.json}`
- `apps/worker/src/jobs/pdf/**`
- `packages/i18n/messages/{uz,ru,meta}/pdf.json`

## WP-13

Telegram-бот.

- `apps/bot/**`
- `!apps/bot/{package.json,tsconfig.json}`
- `packages/telegram/**`
- `!packages/telegram/{package.json,tsconfig.json}`
- `packages/i18n/messages/{uz,ru,meta}/bot.json`

## WP-14

Worker: каркас, outbox, напоминания, порог, очистка.

- `apps/worker/src/{main.ts,health.ts,queues,health}/**`
- `apps/worker/src/jobs/{outbox,orders,warranty,aftercare,threshold,retention,ops}/**`

## WP-15

Конвейер цен.

- `apps/worker/src/jobs/{fx,prices}/**`
- `packages/services/src/prices/**`
- `packages/contracts/src/pricing/**`
- `apps/admin/app/(prices)/**`

## WP-16

Сайт R0: одностраничник и документы. Каркасные `page.tsx`, `globals.css`, `src/i18n`, `src/csp.ts` из WP-00 переходят сюда.

- `apps/web/app/[locale]/{layout.tsx,page.tsx,globals.css,(marketing),legal,requisites}/**`
- `apps/web/proxy.ts`
- `apps/web/app/{sitemap.ts,robots.ts,healthz}/**`
- `apps/web/app/api/internal/**`
- `apps/web/src/{lead-form,i18n}/**`
- `apps/web/src/csp.ts`
- `packages/i18n/messages/{uz,ru,meta}/site.json`

## WP-17

Инфраструктура, деплой, копии, CI.

- `infra/**`
- `!infra/{compose.dev.yml,compose.test.yml}`
- `!infra/postgres/init/**`
- `.github/workflows/**`
- `tools/git-bundle.ps1`

## WP-18

Каталог и правила в админке (R1).

- `apps/admin/app/{(catalog),(rules),(vendors),(perf)}/**`

## WP-19

Конфигуратор ПК и сохранённые сборки (R1).

- `apps/web/app/[locale]/(configurator)/pc/**`
- `apps/web/app/[locale]/s/**`
- `apps/web/components/configurator/**`
- `packages/i18n/messages/{uz,ru,meta}/configurator.json`

## WP-20

Страницы MVP-1 в выбранном направлении (после выбора дизайна; `(marketing)` переходит от WP-16 после R0).

- `apps/web/app/[locale]/(content)/**`
- `packages/ui/src/direction/**`
- `apps/admin/app/(content)/**`
- `apps/worker/src/jobs/ideas/**`
- `packages/i18n/messages/{uz,ru,meta}/content.json`

## WP-21

Сцена на прокрутке (R2).

- `apps/web/components/scene/**`
- `tools/media/**`

## WP-22

Конфигуратор сетапа (R2).

- `apps/web/app/[locale]/(configurator)/setup/**`
- `apps/web/components/plan2d/**`

## WP-23

Кабинет (R2).

- `apps/web/app/[locale]/account/**`
- `packages/services/src/auth-customer/**`

## WP-24

ИИ-консультант (R2).

- `packages/ai/**`
- `!packages/ai/{package.json,tsconfig.json}`
- `apps/web/app/api/ai/**`
- `apps/web/components/chat/**`
- `apps/web/app/[locale]/consultant/**`
- `apps/admin/app/(ai)/**`
- `apps/worker/src/jobs/ai/**`
- `packages/i18n/messages/{uz,ru,meta}/ai.json`

## WP-25

Версия 1: карточка и пути — после R2.

## WP-26

Выпуск и укрепление: своих путей нет, правки — через владельцев путей.
