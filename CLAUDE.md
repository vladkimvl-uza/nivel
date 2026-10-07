# Nivel — правила для агентов

Монорепозиторий платформы Nivel (pnpm 12.9.1, Node 24.21.0). Основа: `docs/ARCHITECTURE.md`, план: `docs/BUILD_PLAN.md`, владение путями: `docs/arch/OWNERSHIP.md`, решения: `docs/arch/ADR-*.md`.

## Машина и Docker

- Это машина владельца (Windows 11). Рядом работают чужие проекты: gas-platform, ai-fin-consultant (aifc), ept, esg-tariffs. Их контейнеры, тома и порты не трогать: 8081, 8010, 8091, 8092, 8095, 8443, 8480, 5433.
- Docker — только с проектом `-p nivel-dev`, `-p nivel-test` (или `-p nivel-<имя>` для проверок, например `nivel-prodcheck`). Команды — через скрипты: `pnpm infra:dev:up|down`, `pnpm infra:test:up|down`.
- Запрещено: `docker system prune`, `docker volume prune`, `docker compose down` без `-p nivel-*`, `docker rm`/`stop` чужих контейнеров, правка `.wslconfig` и настроек Docker Desktop.
- Свои контейнеры: `nivel-dev-pg` (127.0.0.1:54329, том `nivel-dev-pgdata`, `mem_limit: 512m`), `nivel-test-pg` (127.0.0.1:54339, tmpfs 384 МБ, малый WAL, `mem_limit: 640m`).
- Процессы завершать только по PID своего процесса (`taskkill /PID <pid> /T`, `Stop-Process -Id`), сначала проверив его командную строку. Запрещено завершать по имени: `taskkill /IM`, `Stop-Process -Name`, `pkill`, `killall`. 06.10.2026 так были убиты все python.exe на машине, включая чужие.
- В Git Bash `python3` — псевдоним Python Manager из WindowsApps и зависает: вызывать `python`.
- `nivel-test-pg` и `nivel-dev-pg` общие для всех worktree. `pnpm infra:*:up` контейнер не пересоздаёт (`--no-recreate`): путь к `infra/postgres/init` у каждой копии свой, и без флага `up` из другой копии убивал чужой прогон. После правки `infra/compose.*.yml` или `infra/postgres/init/**` нужно выполнить `pnpm infra:test:down`, затем `up` — только интегратору и только когда нет других прогонов.

## Браузер

- Владелец работает на этой машине: видимые окна браузера ему мешают. Браузер — только скрытый.
- Снимки и проверки страниц — Playwright (`headless: true`, по умолчанию) или Edge/Chrome с `--headless=new` **и обязательно** `--user-data-dir=<временная папка в scratchpad>`: без отдельного профиля команда уходит в уже открытый браузер владельца и открывает видимое окно.
- MCP-сервер `chrome-devtools` из плагина ECC не использовать: он запускает видимый Chrome.

## Node и pnpm

- Глобальный Node 25.9 не менять. Node 24.21.0 проект получает через `devEngines.runtime` pnpm: запускать всё через `pnpm run …` / `pnpm exec …`. Запасной путь — `fnm exec --using=.node-version pnpm …` (ADR-003).
- `pnpm ci:local` начинается с `tools/check-node.mjs`: на Node 25 он падает намеренно.
- Версии — только точные, в `catalog:` файла `pnpm-workspace.yaml`. Агент пакета версию не поднимает и зависимость не добавляет сам — заявка интегратору.

## Порты и слоты

- `NIVEL_SLOT` в `.env.local`: 0 — основная папка, 1–9 — worktree. `PORT_BASE = 3100 + 100 × slot`: web +0, admin +1, worker +2, bot +3. Тестовые базы — `nivel_s<slot>_…_test`.
- Перед `pnpm dev` скрипт `check-ports` проверяет, что порты слота свободны.
- Worktree: `git worktree add C:\Users\v.kim\setup-studio-wt\wp-NN -b wp/NN-<имя>`, затем `pnpm install`, `pnpm env:init` и `NIVEL_SLOT=<N>` в `.env.local` worktree.

## Владение и ветки

- Каждый пакет работ меняет только свои глобы из `docs/arch/OWNERSHIP.md`; проверка — `pnpm check:ownership`.
- Только интегратор: корневой `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/db/migrations/**`, `packages/db/src/schema/index.ts`, `docs/arch/**` (кроме `DATA-MAP.md`), этот файл, `infra/compose.{dev,test}.yml`, `infra/postgres/init/**`.
- Замороженные контракты: `packages/domain/src/**/types.ts` — изменение только через ADR и метку `contract`.
- Перед запросом слияния: `pnpm ci:local` зелёный. В `main` пишет только интегратор. `git push` и операции с remote — только по прямому указанию владельца.
- Незаконченная работа сливается выключенным флагом (`ops.settings`, `feature.*`).

## Деньги — красные линии

- Деньги — целые сумы (`Sum`), ставки — базисные пункты (`Bp`); никаких float в деньгах. Плата округляется вниз до сума.
- Расчёт цены, платы, лимита и статуса — только на сервере тем же `packages/domain`; присланные клиентом суммы игнорируются.
- Статус заказа меняет только `services.orders.dispatch` (одна транзакция: статус, `order_events`, `audit_log`, `ops.outbox`).
- Два потока денег не смешиваются: плата — QR Xolis с чеком; деньги на закупку — только перевод на счёт ИП. Своими деньгами за клиента не платим; закупка не сверх лимита без согласия.
- Журналы только дописываются; исправление — записью-сторно. Демо-данные — только с `is_demo`, сид отказывает при `APP_MODE=production`.
- Номер личной карты не появляется ни в шаблонах, ни в текстах.

## Язык

- Код, имена, комментарии, сообщения коммитов в коде — по-английски.
- Тексты интерфейса — узбекский (первым) и русский, ключи ICU в `packages/i18n/messages/{uz,ru,meta}/<ns>.json`. Узбекские oʻ, gʻ — U+02BB, прочие апострофы — U+02BC; U+0027 и U+2019 внутри слов запрещены (`check-uz-text`).
- Админка — только русский. Документы в `docs/` — деловой русский, тезисами.

## Секреты и внешние сервисы

- Секреты — только в `.env.local` (генерирует `pnpm env:init`) и серверном `.env`; в git — `.env.example` без значений. `gitleaks` — шаг `pnpm ci:local`: проверяет историю текущей ветки (`--log-opts=HEAD`), поэтому ветки пакетов проверяются при слиянии в main. Тестовые значения, похожие на секрет, помечать в строке комментарием `gitleaks:allow` с причиной.
- Ничего не регистрировать во внешних сервисах. Без `BOT_TOKEN` бот пишет «disabled: no BOT_TOKEN» и держит только `/healthz`; без `ANTHROPIC_API_KEY` ИИ выключен.
- Тесты не ходят в сеть: `NETWORK_GUARD=1`, MSW для ЦБ, Telegram, Anthropic, Instagram. Тестовый харнесс отказывается работать с портом 54329 и базами без суффикса `_test`.

## Команды

```powershell
pnpm install                 # Node 24.21.0 for the project
pnpm env:init                # .env.local with random dev secrets (once)
pnpm infra:dev:up            # nivel-dev-pg on 127.0.0.1:54329
pnpm infra:test:up           # nivel-test-pg on 127.0.0.1:54339
pnpm db:migrate              # as nivel_migrator
pnpm dev                     # web 3100, admin 3101, worker 3102, bot 3103 (slot 0)
pnpm test; pnpm test:int; pnpm e2e
pnpm ci:local                # full local CI
```
