import { useEffect } from "react";
import { useEditorSession, useEditorView } from "./editor-session";
import type { EditorView } from "./editor-view";
export function useEditorCommand(
  command: NonNullable<EditorView["requestedDialog"]>,
  action: () => void,
) {
  const { editor } = useEditorSession();
  const requested = useEditorView((state) => state.requestedDialog);
  useEffect(() => {
    if (requested !== command) return;
    editor.setState({ requestedDialog: null });
    action();
  }, [requested, command, action, editor]);
}
