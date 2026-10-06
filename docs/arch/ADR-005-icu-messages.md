# ADR-005. ICU JSON вместо Fluent

- Дата: 06.10.2026. Статус: принято. Основа: ARCHITECTURE 1.4, 5.2; блоки 16, 26.

## Контекст

- Блоки 16 и 26 предлагали Fluent (`.ftl`).
- Тексты нужны в трёх средах: сайт (next-intl), бот и PDF (Node без React-контекста). Переводчики не правят код; им нужны контекст и лимиты длины.

## Решение

- Формат — ICU MessageFormat в JSON: `packages/i18n/messages/{uz,ru}/<namespace>.json`; метаданные для переводчика — `messages/meta/<namespace>.json` (`context`, `maxLen`, `screenshot`, `status: draft|reviewed`).
- Сайт — next-intl 4.14.9 (`localePrefix: "always"`, локали `uz`, `ru`, по умолчанию `uz`); бот и PDF — `use-intl` (`createTranslator`) через `packages/i18n`.
- Поток переводчика — XLSX (`pnpm i18n:export|import`, WP-08).
- Числовые аргументы uz и ru взаимозаменяемы, если в русском тексте имя объявлено как `number`, `plural` или `selectordinal`: в узбекском допустимы `{n}`, `{n, number}`, plural и selectordinal (существительное после числа не склоняется, «`{count} ta mahsulot`»). Простой русский `{x}` может нести строку (имя, готовую сумму), его в `number` и plural не превращают. `date`, `time`, `select` и имена аргументов совпадают строго; неизвестный тип аргумента — ошибка синтаксиса.
- Проверки в CI: одинаковые ключи и плейсхолдеры uz/ru, лимиты из `meta` (`check-messages`); апострофы узбекского — U+02BB/U+02BC, без U+0027 и U+2019 внутри слов (`check-uz-text`).

## Проверено в WP-00

- Пространство `common` (uz, ru, meta) подключено к сайту; `/uz` и `/ru` открываются (e2e Playwright, профили Pixel 7 и desktop).
- `check-messages` и `check-uz-text` зелёные; самопроверка ловит `o'zbek` с U+0027.

## Последствия

- После WP-00 `check-uz-text` и `check-messages` переходят к WP-08.
- Новые тексты — ключи в своём пространстве на uz и ru; узбекский черновик агента — `status: "draft"`.
