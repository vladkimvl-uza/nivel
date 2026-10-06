# @nivel/ui — дизайн-система «Ночь и день»

Источник значений: `docs/design/day-night/DESIGN_SYSTEM.md` и прототип `index.html` рядом с ним. Решение владельца Р-18: две темы, `day` и `night`, одна студия в разное время суток.

## Подключение

- Стили: один раз импортировать `src/styles/index.css` (темы, `@font-face`, база, примитивы). Компоненты пишут `var(--ink)`, `var(--bg)`, а не цвета.
- Тема: атрибут `<html data-theme="day|night">`. В `<head>` — `<ThemeInitScript nonce={...} />` (ставит тему до первой отрисовки), внутри `<body>` — `<ThemeProvider>`, переключатель — `<ThemeToggle labels={...} />`. Режим по умолчанию: `?theme=` из адреса, затем сохранённый выбор (`localStorage`, ключ `nv-theme`), затем местное время (07:00–19:00 — день).
- Слой документов: `Paper`, `EstimateTable`/`EstimateRow`, `SumsTable`, `Stamp`/`RoundStamp` (один раз на странице `StampInkDefs`), `Tag`, `Badge` (`demo`, `draft`, `visualization`, `sample`).
- Тексты (uz/ru) приходят из вызывающего кода: пакет переводов не содержит, обязательные подписи нельзя оставить пустыми.
- Свет 3D-сцены для WP-21: `sceneLight`.

## Что и где

- `src/themes/tokens.ts` — все цвета двух тем (сырые цвета разрешены только в `themes/`); `themes.css` генерируется из него.
- `src/fonts/catalog.ts` — девять начертаний; файлы woff2 (сайт) и TTF (PDF) в `fonts/`, лицензии OFL в `fonts/licenses/`.
- После правки токенов или шрифтов: `pnpm exec node packages/ui/scripts/build-css.mjs` (тест падает, если CSS устарел).
- Проверки: `pnpm test` (контраст пар токенов ≥ 4,5:1 в обеих темах, глифы U+02BB и U+02BC в каждом файле шрифта, все классы компонентов есть в CSS), `pnpm check:antilist`.
