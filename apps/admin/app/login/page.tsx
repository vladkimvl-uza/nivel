// Stub until WP-10: e-mail + password (argon2id) + TOTP, lockout after 5 attempts (ARCHITECTURE 6.1).
export default function LoginPage() {
  return (
    <main style={{ maxWidth: 360, margin: "64px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24 }}>Вход в админку</h1>
      <p>Заглушка: вход по паролю и второму фактору появится в WP-10.</p>
      <form aria-disabled="true">
        <fieldset disabled style={{ display: "grid", gap: 12, border: 0, padding: 0 }}>
          <label>
            E-mail
            <input type="email" name="email" autoComplete="username" style={{ display: "block", width: "100%" }} />
          </label>
          <label>
            Пароль
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              style={{ display: "block", width: "100%" }}
            />
          </label>
          <label>
            Код из приложения
            <input
              inputMode="numeric"
              name="totp"
              autoComplete="one-time-code"
              style={{ display: "block", width: "100%" }}
            />
          </label>
          <button type="submit">Войти</button>
        </fieldset>
      </form>
    </main>
  );
}
