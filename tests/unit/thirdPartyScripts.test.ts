/**
 * SEC-43: what the public pages may load from third parties is an allowlist
 * held by this test, not a sentence on the privacy page.
 *
 * `third-party-scripts.json` at the repository root is the list. Today it
 * allows no third-party script at all (`"scripts": []`); the only third-party
 * host the site uses is OpenStreetMap's tile servers, for map images. This
 * file holds that claim four ways:
 *
 *  1. every committed page (index.html, public/**) and, when a build exists,
 *     every built page (dist/**) loads no script, pixel, frame, stylesheet or
 *     other resource from a host that is neither first-party nor listed;
 *  2. the Content-Security-Policy the server sends allows scripts from 'self'
 *     only and names no host that is not on the list, which is what holds the
 *     JavaScript bundle's own requests at runtime;
 *  3. the default tile URL is on the list;
 *  4. the privacy page names every listed vendor and claims no analytics the
 *     list does not contain.
 *
 * Each rule has a negative control: a sabotaged copy that is first checked to
 * contain the sabotage, then checked to fail. A rule that cannot fail would
 * otherwise read as a pass.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { buildApp } from "../../server/app.ts";
import { MemoryRepository } from "../../server/lib/repository.ts";
import { serverConfig } from "../../server/config.ts";
import { config as clientConfig } from "../../src/config.ts";

const ROOT = join(__dirname, "..", "..");
const ALLOWLIST_PATH = join(ROOT, "third-party-scripts.json");

interface ScriptEntry {
  vendor: string;
  src?: string;
  text?: string;
  sha256?: string;
  position: "head" | "body";
}

interface HostEntry {
  vendor: string;
  host: string;
  loads: string;
  receives: string;
}

interface Allowlist {
  privacy_page?: string;
  first_party_hosts: string[];
  scripts: ScriptEntry[];
  third_party_hosts?: HostEntry[];
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")) as Allowlist;

/** Analytics and tag vendors a privacy page might name. */
const ANALYTICS_VENDORS = [
  "Google Analytics",
  "Google Tag Manager",
  "gtag",
  "Plausible",
  "PostHog",
  "Fathom",
  "Matomo",
  "Mixpanel",
  "Segment",
  "Amplitude",
  "Hotjar",
  "Umami",
  "Cloudflare Web Analytics",
];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith("*."))
    return h.endsWith(p.slice(1)) && h.length > p.length - 1;
  return h === p;
}

/** Every host a page may request from, besides its own origin. */
function allowedHosts(list: Allowlist): string[] {
  const scriptHosts = list.scripts.flatMap((s) =>
    s.src ? [new URL(s.src).hostname] : [],
  );
  return [
    ...list.first_party_hosts,
    ...scriptHosts,
    ...(list.third_party_hosts ?? []).map((h) => h.host),
  ];
}

/** The host of an absolute or protocol-relative URL, or null for a same-origin one. */
function externalHost(url: string): string | null {
  const trimmed = url.trim();
  if (!/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed)
      .hostname;
  } catch {
    return trimmed;
  }
}

/** Resource attributes that make the browser fetch something. Links (`<a>`) only navigate. */
const FETCH_ATTRS = [
  "src",
  "href",
  "srcset",
  "data",
  "poster",
  "action",
  "formaction",
];
const NAVIGATION_ONLY = new Set(["A", "AREA"]);

/**
 * The exact source text of every `<script>` element, in document order.
 *
 * An allowlisted loader is pinned by its exact source text, so the match is
 * over the page's own bytes, not a parser's re-serialization (which rewrites
 * `async` as `async=""`). The bytes come from the HTML parser's source
 * offsets, not from a regular expression over the markup: a regex cannot tell
 * a commented-out tag from a live one, and misses end tags the HTML tokenizer
 * accepts (CodeQL js/bad-tag-filter, js/incomplete-multi-character-sanitization).
 * Template contents are skipped, as `querySelectorAll` skips them.
 */
function rawScriptTags(html: string): string[] {
  const out: string[] = [];
  const walk = (node: DefaultTreeAdapterTypes.ParentNode): void => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      if (child.tagName === "script" && child.sourceCodeLocation) {
        const { startOffset, endOffset } = child.sourceCodeLocation;
        out.push(html.slice(startOffset, endOffset));
      }
      walk(child);
    }
  };
  walk(parse(html, { sourceCodeLocationInfo: true }));
  return out;
}

/** Every way `html` breaks the allowlist; empty means the page holds to it. */
export function pageViolations(html: string, list: Allowlist): string[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = allowedHosts(list);
  const isAllowed = (host: string) => allowed.some((p) => hostMatches(host, p));
  const out: string[] = [];

  // jsdom's DOMParser is parse5 too, so the raw tags and the parsed elements
  // are in the same order; the count check holds that assumption.
  const raw = rawScriptTags(html);
  const scripts = Array.from(doc.querySelectorAll("script"));
  if (raw.length !== scripts.length) {
    out.push(
      `found ${scripts.length} script elements but ${raw.length} script tags; cannot match pins`,
    );
  }

  for (const [index, script] of scripts.entries()) {
    const outer = raw[index] ?? script.outerHTML;
    const entry = list.scripts.find(
      (s) => s.text === outer || s.sha256 === sha256(outer),
    );
    const position = script.closest("head") ? "head" : "body";
    if (entry) {
      if (entry.position !== position) {
        out.push(
          `${entry.vendor} loader is in <${position}>, allowed only in <${entry.position}>`,
        );
      }
      continue;
    }
    const src = script.getAttribute("src");
    if (src === null) {
      out.push(`inline script not on the allowlist: ${outer.slice(0, 80)}`);
      continue;
    }
    const host = externalHost(src);
    if (
      host !== null &&
      !list.first_party_hosts.some((p) => hostMatches(host, p))
    ) {
      out.push(`script from ${host} not on the allowlist`);
    }
  }

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.tagName === "SCRIPT" || NAVIGATION_ONLY.has(el.tagName)) continue;
    if (el.tagName === "IFRAME" || el.tagName === "FRAME") {
      const src = el.getAttribute("src") ?? "";
      const host = externalHost(src);
      if (
        host !== null &&
        !list.first_party_hosts.some((p) => hostMatches(host, p))
      ) {
        out.push(`frame from ${host}`);
      }
    }
    for (const attr of FETCH_ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const urls =
        attr === "srcset"
          ? value.split(",").map((c) => c.trim().split(/\s+/)[0])
          : [value];
      for (const url of urls) {
        const host = externalHost(url);
        if (host !== null && !isAllowed(host)) {
          out.push(
            `<${el.tagName.toLowerCase()} ${attr}> requests ${host}, not on the allowlist`,
          );
        }
      }
    }
  }

  const styles = [
    ...Array.from(doc.querySelectorAll("style")).map(
      (s) => s.textContent ?? "",
    ),
    ...Array.from(doc.querySelectorAll("[style]")).map(
      (s) => s.getAttribute("style") ?? "",
    ),
  ];
  for (const css of styles) {
    for (const match of css.matchAll(
      /(?:url\(\s*['"]?|@import\s+['"])([^'")\s]+)/gi,
    )) {
      const host = externalHost(match[1]);
      if (host !== null && !isAllowed(host))
        out.push(`CSS requests ${host}, not on the allowlist`);
    }
  }
  return out;
}

/** Every way a served CSP lets the page reach beyond the allowlist. */
export function cspViolations(directives: string[], list: Allowlist): string[] {
  const out: string[] = [];
  const allowed = allowedHosts(list);
  const scriptHosts = list.scripts.flatMap((s) =>
    s.src ? [new URL(s.src).hostname] : [],
  );
  for (const directive of directives) {
    const [name, ...sources] = directive.split(/\s+/);
    for (const source of sources) {
      if (source.startsWith("'") || /^(?:data|blob):$/.test(source)) continue;
      // A CSP source is a host expression, wildcards included, not a URL.
      const host = source
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
        .split(/[/:]/)[0]
        .toLowerCase();
      if (!host || host.endsWith(":")) continue;
      const listed = allowed.some((p) => hostMatches(host, p) || p === host);
      if (!listed) out.push(`${name} allows ${source}, not on the allowlist`);
      if (
        name === "script-src" &&
        !scriptHosts.some((p) => hostMatches(host, p))
      ) {
        out.push(
          `script-src allows ${source}, which is not an allowlisted script host`,
        );
      }
    }
  }
  const scriptSrc = directives.find((d) => d.startsWith("script-src "));
  if (!scriptSrc) out.push("no script-src directive");
  else if (/'unsafe-inline'|'unsafe-eval'|\*(?:\s|$)/.test(scriptSrc)) {
    out.push(`script-src is not restricted: ${scriptSrc}`);
  }
  return out;
}

/** Every way the privacy page's claims differ from the allowlist. */
export function privacyViolations(pageText: string, list: Allowlist): string[] {
  const text = pageText.toLowerCase();
  const out: string[] = [];
  const vendors = [
    ...list.scripts.map((s) => s.vendor),
    ...(list.third_party_hosts ?? []).map((h) => h.vendor),
  ];
  for (const vendor of vendors) {
    if (!text.includes(vendor.toLowerCase()))
      out.push(`privacy page does not name ${vendor}`);
  }
  const listed = new Set(list.scripts.map((s) => s.vendor.toLowerCase()));
  for (const vendor of ANALYTICS_VENDORS) {
    if (
      !listed.has(vendor.toLowerCase()) &&
      text.includes(vendor.toLowerCase())
    ) {
      out.push(
        `privacy page names ${vendor}, which the allowlist does not contain`,
      );
    }
  }
  if (list.scripts.length === 0 && !/no third-party\s+analytics/.test(text)) {
    out.push(
      "the allowlist has no scripts, but the privacy page does not say there are no third-party analytics",
    );
  }
  return out;
}

function htmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return htmlFiles(path);
    return /\.html?$/i.test(name) ? [path] : [];
  });
}

const PAGES = [
  join(ROOT, "index.html"),
  ...htmlFiles(join(ROOT, "public")),
  ...htmlFiles(join(ROOT, "dist")),
];
const INDEX = readFileSync(join(ROOT, "index.html"), "utf8");

async function servedCsp(): Promise<string[]> {
  const app = await buildApp({
    repo: new MemoryRepository(),
    config: {
      ...serverConfig,
      isProd: false,
      isTest: true,
      sessionSecret: "test-session-secret",
      corsOrigins: [],
      serveClient: false,
      rateLimit: {
        max: 10_000,
        windowMs: 60_000,
        reportsPerHour: 10_000,
        confirmationsPerHour: 10_000,
      },
    } as typeof serverConfig,
    logger: false,
  });
  try {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    const header = res.headers["content-security-policy"];
    expect(typeof header, "no Content-Security-Policy header was served").toBe(
      "string",
    );
    return String(header)
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
  } finally {
    await app.close();
  }
}

/** Assert the sabotage landed before asserting that it fails. */
function sabotage(original: string, edited: string, marker: string): string {
  expect(edited, "the sabotage did not change the page").not.toBe(original);
  expect(edited, "the sabotage marker is missing").toContain(marker);
  return edited;
}

describe("third-party-scripts.json (SEC-43)", () => {
  it("parses, and every entry is pinned and placed", () => {
    expect(Array.isArray(allowlist.scripts)).toBe(true);
    expect(allowlist.first_party_hosts.length).toBeGreaterThan(0);
    for (const s of allowlist.scripts) {
      expect(s.vendor).toBeTruthy();
      expect(Boolean(s.text) || /^[0-9a-f]{64}$/.test(s.sha256 ?? "")).toBe(
        true,
      );
      if (s.text && s.sha256) expect(sha256(s.text)).toBe(s.sha256);
      expect(["head", "body"]).toContain(s.position);
    }
    for (const h of allowlist.third_party_hosts ?? []) {
      expect(h.vendor && h.host && h.loads && h.receives).toBeTruthy();
    }
    expect(
      allowlist.privacy_page && existsSync(join(ROOT, allowlist.privacy_page)),
    ).toBe(true);
  });

  it("checks real pages, so a pass is over something", () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(3);
    expect(PAGES.map((p) => relative(ROOT, p))).toEqual(
      expect.arrayContaining(["index.html", join("public", "privacy.html")]),
    );
  });

  it.each(PAGES.map((p) => [relative(ROOT, p), p]))(
    "%s loads nothing off the allowlist",
    (_name, path) => {
      expect(pageViolations(readFileSync(path, "utf8"), allowlist)).toEqual([]);
    },
  );

  it("the served CSP allows nothing off the allowlist", async () => {
    const directives = await servedCsp();
    expect(directives.length).toBeGreaterThan(5);
    expect(cspViolations(directives, allowlist)).toEqual([]);
  });

  it("the default tile server is on the allowlist", () => {
    const host = new URL(
      clientConfig.tileUrl.replace("{s}", "a").replace(/\{[a-z]\}/g, "0"),
    ).hostname;
    expect(allowedHosts(allowlist).some((p) => hostMatches(host, p))).toBe(
      true,
    );
  });

  it("the privacy page states what the allowlist holds, and nothing more", () => {
    const page = readFileSync(join(ROOT, allowlist.privacy_page!), "utf8");
    const text =
      new DOMParser().parseFromString(page, "text/html").body.textContent ?? "";
    expect(privacyViolations(text, allowlist)).toEqual([]);
  });
});

describe("SEC-43 negative controls: each sabotage lands and fails", () => {
  it("a second, external script fails", () => {
    const marker =
      '<script src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>';
    const page = sabotage(
      INDEX,
      INDEX.replace("</head>", `${marker}</head>`),
      marker,
    );
    expect(pageViolations(page, allowlist)).not.toEqual([]);
  });

  it("an inline script fails", () => {
    const marker = "<script>window.dataLayer = [];</script>";
    const page = sabotage(
      INDEX,
      INDEX.replace("</body>", `${marker}</body>`),
      marker,
    );
    expect(pageViolations(page, allowlist)).not.toEqual([]);
  });

  it("a tracking pixel fails", () => {
    const marker = '<img src="https://pixel.example.net/p.gif" alt="">';
    const page = sabotage(
      INDEX,
      INDEX.replace("</body>", `${marker}</body>`),
      marker,
    );
    expect(pageViolations(page, allowlist)).not.toEqual([]);
  });

  it("a third-party frame fails", () => {
    const marker = '<iframe src="https://ads.example.com/slot"></iframe>';
    const page = sabotage(
      INDEX,
      INDEX.replace("</body>", `${marker}</body>`),
      marker,
    );
    expect(pageViolations(page, allowlist)).not.toEqual([]);
  });

  it("a third-party stylesheet or font fails", () => {
    const marker =
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">';
    const page = sabotage(
      INDEX,
      INDEX.replace("</head>", `${marker}</head>`),
      marker,
    );
    expect(pageViolations(page, allowlist)).not.toEqual([]);
  });

  it("an allowlisted loader passes in place, and fails when changed or moved to the body", () => {
    const loader =
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST"></script>';
    const list: Allowlist = {
      ...allowlist,
      scripts: [
        {
          vendor: "Google Analytics 4",
          src: "https://www.googletagmanager.com/gtag/js?id=G-TEST",
          sha256: sha256(loader),
          position: "head",
        },
      ],
    };
    const inHead = sabotage(
      INDEX,
      INDEX.replace("</head>", `${loader}</head>`),
      loader,
    );
    expect(pageViolations(inHead, list)).toEqual([]);

    const changed = loader.replace("G-TEST", "G-TESU");
    const edited = sabotage(
      INDEX,
      INDEX.replace("</head>", `${changed}</head>`),
      changed,
    );
    expect(pageViolations(edited, list)).not.toEqual([]);

    const inBody = sabotage(
      INDEX,
      INDEX.replace("</body>", `${loader}</body>`),
      loader,
    );
    expect(inBody.indexOf(loader)).toBeGreaterThan(inBody.indexOf("<body"));
    expect(pageViolations(inBody, list)).not.toEqual([]);
  });

  it("a CSP that widens script-src or adds an image host fails", async () => {
    const directives = await servedCsp();
    const widened = directives.map((d) =>
      d.startsWith("script-src ") ? `${d} https://cdn.example.com` : d,
    );
    expect(widened).not.toEqual(directives);
    expect(cspViolations(widened, allowlist)).not.toEqual([]);

    const imgHost = directives.map((d) =>
      d.startsWith("img-src ") ? `${d} https://pixel.example.net` : d,
    );
    expect(imgHost).not.toEqual(directives);
    expect(cspViolations(imgHost, allowlist)).not.toEqual([]);
  });

  it("a privacy page that drops a vendor or claims analytics fails", () => {
    const page = readFileSync(join(ROOT, allowlist.privacy_page!), "utf8");
    const text =
      new DOMParser().parseFromString(page, "text/html").body.textContent ?? "";

    const unnamed = text.replace(/openstreetmap/gi, "a map provider");
    expect(unnamed).not.toBe(text);
    expect(privacyViolations(unnamed, allowlist)).not.toEqual([]);

    const claims = `${text} We use Google Analytics to count visits.`;
    expect(privacyViolations(claims, allowlist)).not.toEqual([]);
  });
});
