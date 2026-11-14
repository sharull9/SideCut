import { ClientOnly, HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import appCss from "@sidecut/ui/globals.css?url";
import { EditorSessionProvider } from "@/modules/workspace/editor-session";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "raE.E",
      },
      { name: "theme-color", content: "#121210" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The whole app is dark, so portalled dialogs, menus and tooltips match the pages.
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground">
        <ClientOnly>
          <EditorSessionProvider>{children}</EditorSessionProvider>
        </ClientOnly>
        <Scripts />
      </body>
    </html>
  );
}
