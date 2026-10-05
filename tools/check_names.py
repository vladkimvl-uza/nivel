"""Проверка доступности названий: домены .uz/.com/.io (whois, порт 43) и имя в Telegram.

Запуск: python tools/check_names.py name1 name2 ...
Вывод: строка JSON на каждое имя.
"""
import json
import re
import socket
import sys
import time
import urllib.request

WHOIS = {
    "uz": "whois.cctld.uz",
    "com": "whois.verisign-grs.com",
    "io": "whois.nic.io",
}

FREE_MARKERS = re.compile(
    r"no match for|not found|no entries found|no data found|domain not found|is available|status:\s*free",
    re.I,
)


def whois(server: str, query: str, timeout: float = 12.0) -> str:
    with socket.create_connection((server, 43), timeout=timeout) as s:
        s.sendall((query + "\r\n").encode())
        chunks = []
        while True:
            data = s.recv(4096)
            if not data:
                break
            chunks.append(data)
    return b"".join(chunks).decode("utf-8", "replace")


def domain_status(name: str, tld: str) -> str:
    try:
        text = whois(WHOIS[tld], f"{name}.{tld}")
    except OSError as exc:
        return f"ошибка: {exc.__class__.__name__}"
    if FREE_MARKERS.search(text):
        return "свободен"
    if re.search(r"domain name:|creation date|created:|registrar", text, re.I):
        return "занят"
    return "неясно"


def telegram_status(name: str) -> str:
    req = urllib.request.Request(
        f"https://t.me/{name}",
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    )
    try:
        html = urllib.request.urlopen(req, timeout=12).read().decode("utf-8", "replace")
    except OSError as exc:
        return f"ошибка: {exc.__class__.__name__}"
    # Несуществующее имя: заглушка «Telegram: Contact @имя» без названия и описания.
    title = re.search(r'property="og:title" content="([^"]*)"', html)
    if title and title.group(1).strip().lower() != f"telegram: contact @{name}":
        return "занят"
    if 'class="tgme_page_extra"' in html:
        return "занят"
    return "свободен или скрыт"


def main(names: list[str]) -> None:
    for raw in names:
        name = raw.strip().lower()
        if re.fullmatch(r"[a-z0-9_]{5,32}", name) and "_" in name:
            # Подчёркивание допустимо только в именах Telegram, домены не проверяем.
            print(json.dumps({"name": name, "telegram": telegram_status(name)}, ensure_ascii=False), flush=True)
            continue
        if not re.fullmatch(r"[a-z0-9-]{2,40}", name):
            print(json.dumps({"name": raw, "error": "недопустимые символы"}, ensure_ascii=False))
            continue
        result = {"name": name}
        for tld in WHOIS:
            result[tld] = domain_status(name, tld)
            time.sleep(0.4)
        result["telegram"] = telegram_status(name) if len(name) >= 5 else "короче 5 символов"
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
