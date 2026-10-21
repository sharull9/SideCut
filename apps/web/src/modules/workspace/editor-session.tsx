import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { BrowserProjectSession } from "./browser-session";

const SessionContext = createContext<BrowserProjectSession | null>(null);

export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new BrowserProjectSession());
  useEffect(() => {
    void session.start();
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
  return <SessionContext value={session}>{children}</SessionContext>;
}

export function useEditorSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Editor session provider is missing.");
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, snapshot };
}
