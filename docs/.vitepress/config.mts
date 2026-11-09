import { defineConfig, type HeadConfig } from "vitepress";
import { withMermaid } from "vitepress-mermaid-viewer";
import {
  documentationVersion,
  documentationVersionLabel,
  documentationVersionPlugin,
} from "./version.ts";

// Set DOPGATE_DOCS_URL to the published address when the docs go online.
const siteUrl = (process.env.DOPGATE_DOCS_URL ?? "http://localhost:5173").replace(/\/$/, "");
const siteName = "Dopgate";
const siteDescription =
  "Dopgate is a self-hosted auth server for one app. It runs next to your app with PostgreSQL and handles sign-up, sign-in, email codes, password resets, and JWTs your backend verifies offline.";
const sectionNames: Record<string, string> = {
  guide: "Guide",
  cli: "CLI",
  "self-hosting": "Self-hosting",
  reference: "Reference",
  about: "About",
};

function buildBreadcrumbs(cleanPath: string, title: string) {
  const section = cleanPath.split("/")[0];
  const crumbs = [{ name: "Docs", url: `${siteUrl}/` }];
  if (sectionNames[section]) {
    crumbs.push({ name: sectionNames[section], url: `${siteUrl}/${section}/` });
  }
  if (cleanPath !== `${section}/`) {
    crumbs.push({ name: title, url: `${siteUrl}/${cleanPath}` });
  }

  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

function buildJsonLd(pageData: {
  relativePath: string;
  cleanPath: string;
  title: string;
  description: string;
  url: string;
  dateModified?: string;
}): string {
  const website = {
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    url: `${siteUrl}/`,
    name: siteName,
    description: siteDescription,
    inLanguage: "en-US",
  };

  if (pageData.relativePath === "index.md") {
    return JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        website,
        {
          "@type": "SoftwareApplication",
          name: siteName,
          softwareVersion: documentationVersion,
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Linux, macOS",
          description: pageData.description,
          url: pageData.url,
          license: "https://spdx.org/licenses/Apache-2.0.html",
        },
      ],
    });
  }

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: pageData.title,
        description: pageData.description,
        url: pageData.url,
        mainEntityOfPage: pageData.url,
        inLanguage: "en-US",
        ...(pageData.dateModified && { dateModified: pageData.dateModified }),
        isPartOf: { "@id": `${siteUrl}/#website` },
      },
      buildBreadcrumbs(pageData.cleanPath, pageData.title),
    ],
  });
}

const config = defineConfig({
  title: "Dopgate",
  titleTemplate: ":title · dopgate",
  description: siteDescription,
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: siteUrl },
  mermaid: {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    flowchart: { htmlLabels: false },
  },
  transformHead({ pageData, title: fullTitle }) {
    if (pageData.isNotFound || pageData.relativePath === "404.md") {
      return [["meta", { name: "robots", content: "noindex" }]];
    }

    const cleanPath = pageData.relativePath
      .replace(/(^|\/)index\.md$/, "$1")
      .replace(/\.md$/, "");
    const url = `${siteUrl}/${cleanPath}`;
    const title = pageData.title || siteName;
    const description =
      (pageData.frontmatter?.description as string | undefined) ??
      siteDescription;
    const isHome = pageData.relativePath === "index.md";
    const dateModified = pageData.lastUpdated
      ? new Date(pageData.lastUpdated).toISOString()
      : undefined;

    const head: HeadConfig[] = [
      ["link", { rel: "canonical", href: url }],
      ["meta", { property: "og:title", content: fullTitle }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: url }],
      ["meta", { property: "og:type", content: isHome ? "website" : "article" }],
      ["meta", { property: "og:site_name", content: siteName }],
      ["meta", { property: "og:locale", content: "en_US" }],
      ["meta", { name: "twitter:card", content: "summary" }],
      ["meta", { name: "twitter:title", content: fullTitle }],
      ["meta", { name: "twitter:description", content: description }],
      [
        "script",
        { type: "application/ld+json" },
        buildJsonLd({
          relativePath: pageData.relativePath,
          cleanPath,
          title,
          description,
          url,
          dateModified,
        }),
      ],
    ];
    if (!isHome && dateModified) {
      head.push([
        "meta",
        { property: "article:modified_time", content: dateModified },
      ]);
    }
    return head;
  },
  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        sizes: "any",
        href: "/favicon.svg",
      },
    ],
    ["meta", { name: "theme-color", content: "#ff4053" }],
  ],
  markdown: {
    theme: { light: "github-light", dark: "github-dark" },
    image: { lazyLoad: true },
  },
  vite: {
    publicDir: "../public",
    plugins: [documentationVersionPlugin()],
    optimizeDeps: {
      include: ["mermaid", "fastdom"],
    },
    build: {
      chunkSizeWarningLimit: 800,
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Dopgate",
    search: { provider: "local" },
    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "^/guide/" },
      { text: "CLI", link: "/cli/", activeMatch: "^/cli/" },
      {
        text: "Self-hosting",
        link: "/self-hosting/",
        activeMatch: "^/self-hosting/",
      },
      { text: "Reference", link: "/reference/", activeMatch: "^/reference/" },
      { text: "About", link: "/about/", activeMatch: "^/about/" },
      {
        text: documentationVersionLabel,
        items: [
          { text: "Product status", link: "/guide/product-status" },
          { text: "Roadmap", link: "/about/roadmap" },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Getting started",
          items: [
            { text: "Introduction", link: "/guide/" },
            { text: "Quick start", link: "/guide/quick-start" },
            { text: "Add dopgate to your app", link: "/guide/add-to-your-app" },
            { text: "Product status", link: "/guide/product-status" },
          ],
        },
        {
          text: "Accounts",
          items: [
            { text: "Admins and users", link: "/guide/admins-and-users" },
            { text: "Sign-up and email verification", link: "/guide/sign-up-and-verification" },
            { text: "Sign-in with a password or a code", link: "/guide/sign-in" },
            { text: "Password reset", link: "/guide/password-reset" },
            { text: "Profile and metadata", link: "/guide/profile-and-metadata" },
          ],
        },
        {
          text: "Tokens and admin",
          items: [
            { text: "Tokens and sessions", link: "/guide/tokens-and-sessions" },
            { text: "Personal tokens", link: "/guide/personal-tokens" },
            { text: "Agents", link: "/guide/agents" },
            { text: "Calling the admin API", link: "/guide/admin-api" },
            { text: "Email templates", link: "/guide/email-templates" },
            { text: "Rate limits and lockout", link: "/guide/rate-limits" },
            { text: "Admin console", link: "/guide/admin-console" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "Command line",
          items: [
            { text: "CLI overview", link: "/cli/" },
            { text: "Commands", link: "/cli/commands" },
          ],
        },
      ],
      "/self-hosting/": [
        {
          text: "Deploy",
          items: [
            { text: "Overview", link: "/self-hosting/" },
            { text: "Docker image", link: "/self-hosting/docker" },
            { text: "Running with your app's stack", link: "/self-hosting/with-your-app" },
            { text: "PostgreSQL and the schema", link: "/self-hosting/postgres" },
            { text: "Email (SMTP)", link: "/self-hosting/smtp" },
            { text: "Configuration", link: "/self-hosting/configuration" },
          ],
        },
        {
          text: "Operate",
          items: [
            { text: "Backups", link: "/self-hosting/backups" },
            { text: "Upgrading", link: "/self-hosting/upgrading" },
            { text: "Security checklist", link: "/self-hosting/security-checklist" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Overview",
          items: [{ text: "Reference overview", link: "/reference/" }],
        },
        {
          text: "API",
          items: [
            { text: "REST API", link: "/reference/api" },
            { text: "Token claims", link: "/reference/token-claims" },
            { text: "Errors", link: "/reference/errors" },
            { text: "Email template variables", link: "/reference/email-template-variables" },
            { text: "Environment variables", link: "/reference/environment-variables" },
          ],
        },
        {
          text: "Security",
          items: [
            { text: "Security model", link: "/reference/security" },
            { text: "Audit events", link: "/reference/audit-events" },
          ],
        },
        {
          text: "Terms",
          items: [{ text: "Glossary", link: "/reference/glossary" }],
        },
      ],
      "/about/": [
        {
          text: "About dopgate",
          items: [
            { text: "Principles", link: "/about/" },
            { text: "Roadmap", link: "/about/roadmap" },
          ],
        },
      ],
    },
    outline: { level: [2, 3], label: "On this page" },
    docFooter: { prev: "Previous page", next: "Next page" },
    returnToTopLabel: "Back to top",
    sidebarMenuLabel: "Menu",
    darkModeSwitchLabel: "Appearance",
    footer: {
      message: "Self-hosted authentication for your app, on PostgreSQL.",
      copyright: "Apache-2.0",
    },
  },
});

export default withMermaid(config);
