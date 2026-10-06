# @nivel/ui — дизайн-система «Ночная съёмка»

Источник значений: `docs/design/day-night/DESIGN_SYSTEM.md` (колонка ночи) и прототип `index.html` рядом с ним. Решение владельца от 06.10.2026 (Р-18, ADR-006): тема одна — ночь. Дневной версии нет; выбора по времени, переключателя и запоминания выбора тоже нет.

## Два входа: какой для какой среды

- Ядро: `src/index.ts` (имя пакета `@nivel/ui`). Только `.ts`, без react и JSX: токены ночи (`themeTokens`), `brand`, `defaultTheme` (`"night"`), `sceneLight`, шрифты (`fontFaces`, `fontFile`), `formatAmount`/`formatBp`. Грузится в чистом Node (`node src/main.ts` у worker и bot, рендер PDF в `@nivel/pdf`) и в браузере. Тест `entries.test.ts` запускает его в отдельном процессе Node и следит, чтобы в графе ядра не появились `.tsx` и react.
- React: `src/react.ts` (путь `@nivel/ui/react`). Примитивы: `Button`, `TextField`, `Select`, `Paper`, `EstimateTable`, `SumsTable`, `Stamp`, `RoundStamp`, `Tag`, `Badge`, `Money`. Только для кода, который собирает сборщик (Next.js с `transpilePackages`) или vitest; из worker, bot и pdf его не импортировать.

## Подключение (apps/web)

- Стили: один раз в CSS приложения `@import "@nivel/ui/styles.css"` (или относительным путём к `src/styles/index.css`). Это темы, `@font-face`, база, примитивы. Компоненты пишут `var(--ink)`, `var(--bg)`, а не цвета.
- Корень страницы: `<html lang={…} data-theme={defaultTheme}>`. Сервер рисует `"night"`, скрипта и `suppressHydrationWarning` не нужно: атрибут не меняется. Страница без атрибута тоже ночная (`:root` и `[data-theme="night"]` — одно правило).
- Атрибут `data-theme` оставлен намеренно: вторую тему можно вернуть, не трогая компоненты (член в `themes`, набор в `themeTokens`, правило в `themes.css`).
- `<meta name="theme-color">` — значение `themeTokens.night.themeColor`.
- Слой документов: `Paper`, `EstimateTable`/`EstimateRow`, `SumsTable`, `Stamp`/`RoundStamp` (один раз на странице `StampInkDefs`), `Tag`, `Badge` (`demo`, `draft`, `visualization`, `sample`). Документы лежат на «бумаге» `.nv-paper` внутри ночной страницы. Штампы `rect` и `RoundStamp` рассчитаны только на бумагу; малый штамп (`variant="small"`) вне бумаги берёт `--accent-ink`, на бумаге `--stamp`.
- Вспомогательные классы: `.nv-lamp` (тёплое пятно лампы за блоком, всегда включено), `.nv-stamp--press` (оттиск штампа за 450 мс, при «уменьшить движение» отключён), `.nv-sr` (текст только для чтения с экрана).
- Тексты (uz/ru) приходят из вызывающего кода: пакет переводов не содержит, обязательные подписи нельзя оставить пустыми.
- Свет 3D-сцены для WP-21: `sceneLight` (ядро), только ночной набор. Первый экран сайта теперь видео владельца; экспорт оставлен на будущее.
- Шрифты для PDF: `fontFile(face, "ttf")` отдаёт имя файла в `fonts/`; путь к каталогу — `import.meta.resolve("@nivel/ui/fonts/…")`.

## Что и где

- `src/themes/tokens.ts` — все цвета ночи и бумаги (сырые цвета разрешены только в `themes/`); `themes.css` генерируется из него; `src/themes/ids.ts` — `themes`, `defaultTheme`.
- `src/fonts/catalog.ts` — девять начертаний; файлы woff2 (сайт) и TTF (PDF) в `fonts/`, лицензии OFL в `fonts/licenses/`.
- После правки токенов или шрифтов: `pnpm exec node packages/ui/scripts/build-css.mjs` (тест падает, если CSS устарел).
- Снимки Playwright: каталог `e2e/` и `playwright.config.ts` принадлежат интегратору; страницы-витрины примитивов пока нет, снимки не сняты.
- Проверки: `pnpm test` (контраст пар токенов ночи и бумаги ≥ 4,5:1; глифы U+02BB и U+02BC в каждом файле шрифта; все классы компонентов есть в CSS; в стилях нет `[data-theme="day"]`; `defaultTheme === "night"`), `pnpm check:antilist`.
