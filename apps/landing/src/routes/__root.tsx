import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "@/styles.css?url";

const description =
  "raE.E is a local-first video editor for the browser and desktop. Record, edit, review and deliver in one place.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "raE.E — from first take to final cut" },
      { name: "description", content: description },
      { property: "og:title", content: "raE.E" },
      { property: "og:description", content: description },
      { property: "og:image", content: "/og.png" },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#fafaf9" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl px-6 pt-32">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a className="mt-4 inline-block text-brand-deep underline" href="/">
        Back to raE.E
      </a>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
