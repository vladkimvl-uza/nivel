import { describe, expect, it } from "vitest";
import {
  checkPasswordPolicy,
  createNodeArgon2Hasher,
  decodePhc,
  encodePhc,
  type PasswordHasher,
  randomPassword,
} from "./password.ts";

describe("argon2id hasher (node:crypto)", () => {
  const hasher: PasswordHasher = createNodeArgon2Hasher();

  it("writes a PHC string with the OWASP parameters and a fresh salt each time", async () => {
    const a = await hasher.hash("correct horse battery");
    const b = await hasher.hash("correct horse battery");
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hasher.hash("correct horse battery");
    expect(await hasher.verify(hash, "correct horse battery")).toBe(true);
    expect(await hasher.verify(hash, "correct horse batterY")).toBe(false);
    expect(await hasher.verify(hash, "")).toBe(false);
  });

  it("reads hashes written with other parameters (a library can write them later)", async () => {
    const cheap = createNodeArgon2Hasher({ memoryKiB: 64, passes: 1 });
    const hash = await cheap.hash("pa55word-long-enough");
    expect(hash).toContain("m=64,t=1,p=1");
    expect(await hasher.verify(hash, "pa55word-long-enough")).toBe(true);
  });

  it("answers false, not an exception, for garbage and for another algorithm", async () => {
    expect(await hasher.verify("", "x")).toBe(false);
    expect(await hasher.verify("plain", "x")).toBe(false);
    expect(await hasher.verify("$argon2i$v=19$m=64,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaA", "x")).toBe(false);
    expect(await hasher.verify("$argon2id$v=19$m=64,t=1,p=1$$", "x")).toBe(false);
    expect(await hasher.verify("$argon2id$v=19$m=huge,t=1,p=1$c2FsdHNhbHRzYWx0$aGFzaA", "x")).toBe(false);
  });

  it("does not accept absurd cost parameters from a stored string", async () => {
    const hostile = encodePhc({
      memoryKiB: 4_194_304,
      passes: 3,
      parallelism: 1,
      salt: Buffer.alloc(16),
      hash: Buffer.alloc(32),
    });
    expect(await hasher.verify(hostile, "x")).toBe(false);
  });

  it("encodes and decodes PHC strings", () => {
    const phc = encodePhc({
      memoryKiB: 19456,
      passes: 2,
      parallelism: 1,
      salt: Buffer.from("0123456789abcdef"),
      hash: Buffer.alloc(32, 7),
    });
    expect(decodePhc(phc)).toEqual({
      memoryKiB: 19456,
      passes: 2,
      parallelism: 1,
      salt: Buffer.from("0123456789abcdef"),
      hash: Buffer.alloc(32, 7),
    });
    expect(decodePhc("nonsense")).toBeNull();
  });
});

describe("password policy", () => {
  it("wants at least 14 characters", () => {
    expect(checkPasswordPolicy("short-pass-1", {})).toEqual(["Пароль короче 14 знаков."]);
    expect(checkPasswordPolicy("long-enough-pass", {})).toEqual([]);
  });

  it("counts characters, not UTF-16 units, and allows any script", () => {
    expect(checkPasswordPolicy("парольпарольпарол", {})).toEqual([]);
    const faces = [..."😀😁😂🤣😃😄😅😆😉😊😋😎😍😘"];
    expect(faces).toHaveLength(14);
    expect(checkPasswordPolicy(faces.slice(0, 13).join(""), {})).toHaveLength(1);
    expect(checkPasswordPolicy(faces.join(""), {})).toEqual([]);
  });

  it("refuses the e-mail name, one repeated character and an absurd length", () => {
    expect(checkPasswordPolicy("vladimir-nivel-2026", { email: "vladimir@nivel.uz" })).toEqual([
      "Пароль не должен содержать имя из e-mail.",
    ]);
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaaa", {})).toEqual(["Пароль состоит из одного повторяющегося знака."]);
    expect(checkPasswordPolicy(`${"x".repeat(257)}y`, {})).toEqual(["Пароль длиннее 256 знаков."]);
  });

  it("generates passwords that pass the policy", () => {
    const password = randomPassword();
    expect(checkPasswordPolicy(password, {})).toEqual([]);
    expect(randomPassword()).not.toBe(password);
  });
});
