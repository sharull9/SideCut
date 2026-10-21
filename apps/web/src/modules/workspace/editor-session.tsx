import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { ProjectCoordinator } from "@sidecut/core/coordinator";
import { decodeProjectFile } from "@sidecut/contracts/project";

function createSession() {
  const video = ["Screen", "Camera", "B-roll", "Graphics", "Text"].map((name, index) => ({
    id: `trk_video_${index}`,
    kind: "video",
    name,
    rippleMode: index < 2 ? "cut" : "follow",
  }));
  const audio = ["Voice", "Music", "SFX"].map((name, index) => ({
    id: `trk_audio_${index}`,
    kind: "audio",
    name,
    rippleMode: index === 0 ? "cut" : "follow",
  }));
  return new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: "prj_session",
        name: "Untitled sequence",
        videoTracks: video,
        audioTracks: audio,
      },
    }),
  );
}

const SessionContext = createContext<ProjectCoordinator | null>(null);

export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(createSession);
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
