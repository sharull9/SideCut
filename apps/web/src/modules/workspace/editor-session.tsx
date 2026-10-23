import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode, Context } from "react";
import { BrowserProjectSession } from "./browser-session";
import { useStore } from "zustand";
import { createEditorView } from "./editor-view";
import type { EditorView } from "./editor-view";

type SessionContextValue = {
  session: BrowserProjectSession;
  editor: ReturnType<typeof createEditorView>;
};
// Keep provider and hooks on the same context while Vite refreshes their modules.
const SessionContext =
  (import.meta.hot?.data.sessionContext as Context<SessionContextValue | null> | undefined) ??
  createContext<SessionContextValue | null>(null);
if (import.meta.hot) import.meta.hot.data.sessionContext = SessionContext;

export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new BrowserProjectSession());
  const [editor] = useState(createEditorView);
  useEffect(() => {
    void session.start();
    // Fonts imported in earlier sessions stay on this device.
    void import("@sidecut/platform-browser/text").then(({ restoreFonts }) => restoreFonts());
    const leave = (event: BeforeUnloadEvent) => {
      const state = session.getSnapshot();
      if (
        !state.readOnly &&
        (state.saveState === "saving" || state.saveState === "error" || state.busy)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => {
      void session.close();
    };
    const show = (event: PageTransitionEvent) => {
      if (event.persisted) void session.start();
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
      void session.close();
    };
  }, [session]);
  return <SessionContext value={{ session, editor }}>{children}</SessionContext>;
}

export function useEditorSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Editor session provider is missing.");
  const { session, editor } = context;
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, snapshot, editor };
}

export function useEditorView<T>(selector: (state: EditorView) => T): T {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Editor session provider is missing.");
  return useStore(context.editor, selector);
}
