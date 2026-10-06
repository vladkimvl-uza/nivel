# @nivel/ui — дизайн-система «Ночь и день»

Источник значений: `docs/design/day-night/DESIGN_SYSTEM.md` и прототип `index.html` рядом с ним. Решение владельца Р-18: две темы, `day` и `night`, одна студия в разное время суток.

## Два входа: какой для какой среды

- Ядро: `src/index.ts` (имя пакета `@nivel/ui`). Только `.ts`, без react и JSX: токены двух тем, `brand`, `sceneLight`, шрифты (`fontFaces`, `fontFile`), `formatAmount`/`formatBp`, логика выбора темы (`resolveTheme`, `themeByLocalTime`, контроллер), `themeInitScript()` как строка. Грузится в чистом Node (`node src/main.ts` у worker и bot, рендер PDF в `@nivel/pdf`) и в браузере. Тест `entries.test.ts` запускает его в отдельном процессе Node и следит, чтобы в графе ядра не появились `.tsx` и react.
- React: `src/react.ts` (путь пакета `@nivel/ui/react`, нужна заявка интегратору, см. ниже). Примитивы, `ThemeProvider`, `useTheme`, `ThemeToggle`, `ThemeInitScript`. Только для кода, который собирает сборщик (Next.js с `transpilePackages`) или vitest; из worker, bot и pdf его не импортировать.
- `apps/web` сейчас берёт из ядра `defaultTheme`; React-вход подключается после того, как интегратор откроет путь `./react`.

## Подключение (apps/web)

- Стили: один раз в CSS приложения, `@import "…/packages/ui/src/styles/index.css"` относительным путём (после заявки интегратору, путь `@nivel/ui/styles.css`). Это темы, `@font-face`, база, примитивы. Компоненты пишут `var(--ink)`, `var(--bg)`, а не цвета.
- Корень страницы: `<html lang={…} data-theme="day" suppressHydrationWarning>`. Сервер рисует `defaultTheme`, а скрипт в `<head>` меняет атрибут до гидратации, поэтому без `suppressHydrationWarning` React в режиме разработки сообщит о расхождении.
- В `<head>`: `<ThemeInitScript nonce={…} />` (ставит тему и `<meta name="theme-color">` до первой отрисовки). Внутри `<body>`: `<ThemeProvider>`, переключатель `<ThemeToggle labels={…} />`. Выбор темы: `?theme=` из адреса, затем сохранённый выбор (`localStorage`, ключ `nv-theme`), затем местное время (07:00–19:00 — день).
- Событие смены темы: `nv-theme` на `document` (константа `THEME_EVENT`), `detail` равен `{ theme, animate }`, как в DESIGN_SYSTEM 7.4. Тема первой отрисовки событием не объявляется: сцена читает `document.documentElement.dataset.theme` при старте и слушает событие дальше.
- Слой документов: `Paper`, `EstimateTable`/`EstimateRow`, `SumsTable`, `Stamp`/`RoundStamp` (один раз на странице `StampInkDefs`), `Tag`, `Badge` (`demo`, `draft`, `visualization`, `sample`). Штампы `rect` и `RoundStamp` рассчитаны только на бумагу (`Paper`); малый штамп (`variant="small"`) вне бумаги берёт `--accent-ink`, на бумаге `--stamp`.
- Вспомогательные классы: `.nv-lamp` (тёплое пятно лампы за блоком, сила задаётся ролью `--lamp-opacity`, днём пятна нет), `.nv-stamp--press` (оттиск штампа за 450 мс, при «уменьшить движение» отключён), `.nv-sr` (текст только для чтения с экрана).
- Тексты (uz/ru) приходят из вызывающего кода: пакет переводов не содержит, обязательные подписи нельзя оставить пустыми.
- Свет 3D-сцены для WP-21: `sceneLight` (ядро).
- Шрифты для PDF: `fontFile(face, "ttf")` отдаёт имя файла в `fonts/`; путь к каталогу — через `import.meta.resolve("@nivel/ui/fonts/…")` после заявки интегратору.

## Заявка интегратору: package.json пакета

Файл не принадлежит WP-09 (OWNERSHIP). Нужные `exports`:

```json
{
  ".": "./src/index.ts",
  "./react": "./src/react.ts",
  "./styles.css": "./src/styles/index.css",
  "./themes.css": "./src/themes/themes.css",
  "./fonts/*": "./fonts/*",
  "./package.json": "./package.json"
}
```

## Что и где

- `src/themes/tokens.ts` — все цвета двух тем (сырые цвета разрешены только в `themes/`); `themes.css` генерируется из него.
- `src/fonts/catalog.ts` — девять начертаний; файлы woff2 (сайт) и TTF (PDF) в `fonts/`, лицензии OFL в `fonts/licenses/`.
- После правки токенов или шрифтов: `pnpm exec node packages/ui/scripts/build-css.mjs` (тест падает, если CSS устарел).
- Снимки Playwright двух тем не сделаны: каталог `e2e/` и `playwright.config.ts` принадлежат интегратору; нужна страница-витрина в `apps/web` или разрешение на `e2e/ui-*.spec.ts`. Пока обе темы проверены вручную в браузере на витрине примитивов.
- Проверки: `pnpm test` (контраст пар токенов ≥ 4,5:1 в обеих темах, глифы U+02BB и U+02BC в каждом файле шрифта, все классы компонентов есть в CSS), `pnpm check:antilist`.
