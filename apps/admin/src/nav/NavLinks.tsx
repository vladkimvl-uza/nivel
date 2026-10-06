"use client";

import { usePathname } from "next/navigation";

/** The menu links; the section the person is in is marked (the only reason this is a client component). */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="adm-nav" aria-label="Разделы">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          aria-current={path === item.href || path.startsWith(`${item.href}/`) ? "page" : undefined}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
