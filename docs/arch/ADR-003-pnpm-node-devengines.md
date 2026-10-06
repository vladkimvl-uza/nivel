# ADR-003. pnpm 12 и Node 24 через `devEngines`

- Дата: 06.10.2026. Статус: принято, спайк WP-00 пройден. Основа: ARCHITECTURE 1.2, 1.3; BUILD_PLAN 4.2.

## Контекст

- На машине владельца глобально стоит Node 25.9 (нечётная ветка без LTS); `engines` vitest 5.0.3 её исключают. Глобальный Node менять нельзя.
- fnm ненадёжен в неинтерактивных оболочках агентов (PowerShell, Git Bash).
- 4–5 параллельных агентов: нужен каталог версий, строгий `node_modules`, защита цепочки поставки.

## Решение

- pnpm 12.9.1 (`npm i -g pnpm@12.9.1`, нативный исполняемый файл).
- Корневой `package.json`: `packageManager: pnpm@12.9.1`; `devEngines.runtime` — node 24.21.0, `devEngines.packageManager` — pnpm 12.9.1, оба `onFail: "download"`; `engines.node: ">=24.21"` без `engine-strict`.
- `.node-version` = `24.21.0` — для редакторов и запасного пути.
- `tools/check-node.mjs` — первый шаг `pnpm ci:local`, требует мажорную версию 24.
- Цепочка поставки: точные версии в `catalog:`, `--frozen-lockfile`, `minimumReleaseAge: 4320` с исключением `next`, белый список сборочных скриптов.

## Спайк «Node через pnpm» (06.10.2026)

| Проверка | PowerShell | Git Bash |
| --- | --- | --- |
| `node -v` (глобальный) | v25.9.0 | v25.9.0 |
| `pnpm exec node -v` | v24.21.0 | v24.21.0 |
| `node tools/check-node.mjs` (глобальный 25) | падает, код 1 | падает, код 1 |
| `pnpm run check:node` | `Node 24.21.0 OK`, код 0 | `Node 24.21.0 OK`, код 0 |

- `pnpm dev` запускает приложения через `tools/dev-run.mjs` тем же `process.execPath` (Node 24.21.0 из `devEngines`); проверено по процессам на портах 3100–3103.
- Запасной путь `fnm exec --using=.node-version pnpm …` не понадобился; оставлен в `check-node` как подсказка.

## Отклонения от документа

- `onlyBuiltDependencies` (ARCHITECTURE 1.3, 10.1 A03, BUILD_PLAN 4.1) в pnpm 11+ заменён на `allowBuilds` и молча игнорируется (CHANGELOG pnpm 12.9.1). В `pnpm-workspace.yaml` — `allowBuilds: { sharp: true, "@node-rs/argon2": true }`; явный запрет для `esbuild`, `@swc/core`, `@parcel/watcher` (готовые бинарники приходят опциональными пакетами платформы).
- Временные исключения `minimumReleaseAgeExclude` для `msw@3.0.2` (опубликован 03.10.2026), `pg-boss@12.36.0` и `pino@10.4.0` (02.10.2026) действовали 05.10.2026; 06.10.2026 сняты — все три старше 72 ч, `pnpm install --frozen-lockfile` проходит без них. Остаётся только `next`.
- `npm` внутри папки проекта на глобальном Node 25 падает с `EBADDEVENGINES` (npm проверяет `devEngines.runtime`). Это ожидаемо: в проекте работает только pnpm; `npm view` и подобные — вне папки проекта.

## Последствия

- Агенты запускают всё через `pnpm run` / `pnpm exec`; прямой `node` из оболочки — Node 25, и `check-node` это ловит.
- Переход на Node 26 (LTS с 28.10.2026) — отдельный пакет работ в I квартале 2027.
- Запасной путь без pnpm — npm workspaces (структура папок та же), переход за час.
