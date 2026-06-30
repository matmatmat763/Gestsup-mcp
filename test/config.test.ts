import { describe, it, expect } from "vitest";
import { loadConfig, isPrivateHost } from "../src/config.js";

const base = {
  GESTSUP_BASE_URL: "https://support.exemple.fr",
  GESTSUP_API_KEY: "secret-key",
};

describe("loadConfig", () => {
  it("charge une config minimale valide", () => {
    const c = loadConfig(base as any);
    expect(c.baseUrl).toBe("https://support.exemple.fr");
    expect(c.allowWrites).toBe(true);
    expect(c.vaultDocsFolder).toBe("KB");
    expect(c.docQualityThreshold).toBe(60);
  });

  it("impose HTTPS", () => {
    expect(() => loadConfig({ ...base, GESTSUP_BASE_URL: "http://x.fr" } as any)).toThrow(/https/);
  });

  it("refuse INSECURE_TLS vers un hôte public", () => {
    expect(() => loadConfig({ ...base, GESTSUP_INSECURE_TLS: "true" } as any)).toThrow(
      /MITM|public/i,
    );
  });

  it("autorise INSECURE_TLS vers localhost / IP privée", () => {
    expect(() =>
      loadConfig({
        GESTSUP_BASE_URL: "https://localhost",
        GESTSUP_API_KEY: "k",
        GESTSUP_INSECURE_TLS: "true",
      } as any),
    ).not.toThrow();
    expect(() =>
      loadConfig({
        GESTSUP_BASE_URL: "https://192.168.1.10",
        GESTSUP_API_KEY: "k",
        GESTSUP_INSECURE_TLS: "true",
      } as any),
    ).not.toThrow();
  });

  it("lit les variables Obsidian", () => {
    const c = loadConfig({
      ...base,
      OBSIDIAN_VAULT_PATH: "/mnt/v",
      OBSIDIAN_DOCS_FOLDER: "Base",
      OBSIDIAN_ALLOW_WRITES: "false",
    } as any);
    expect(c.vaultPath).toBe("/mnt/v");
    expect(c.vaultDocsFolder).toBe("Base");
    expect(c.vaultAllowWrites).toBe(false);
  });
});

describe("isPrivateHost", () => {
  it("reconnaît local/privé", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "gestsup.local",
      "monserveur",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.0.1",
    ]) {
      expect(isPrivateHost(h)).toBe(true);
    }
  });
  it("reconnaît public", () => {
    for (const h of ["support.exemple.fr", "8.8.8.8", "172.32.0.1", "example.com"]) {
      expect(isPrivateHost(h)).toBe(false);
    }
  });
});
