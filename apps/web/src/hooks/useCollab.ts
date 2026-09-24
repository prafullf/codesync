import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import { colorForUser, YDOC_TEXT_KEY } from '@codesync/shared';
import type { monaco } from '../lib/monaco';
import { wsBaseUrl } from '../lib/config';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Binds a Monaco editor to the room's shared Y.Doc.
 *
 * Yjs is a CRDT: every client applies edits locally first and merges remote
 * ones deterministically, so offline edits are kept and synced on reconnect.
 */
export function useCollab(
  roomId: string,
  editor: monaco.editor.IStandaloneCodeEditor | null,
  user: { id: string; name: string } | null,
) {
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const docRef = useRef<Y.Doc | null>(null);
  const userId = user?.id;
  const userName = user?.name;

  useEffect(() => {
    const model = editor?.getModel();
    if (!editor || !model || !userId || !userName) return;

    const doc = new Y.Doc();
    docRef.current = doc;
    const provider = new WebsocketProvider(`${wsBaseUrl()}/yjs`, roomId, doc);
    const onStatus = ({ status: s }: { status: CollabStatus }) => setStatus(s);
    provider.on('status', onStatus);

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', { name: userName, color: colorForUser(userId) });
    const binding = new MonacoBinding(doc.getText(YDOC_TEXT_KEY), model, new Set([editor]), awareness);

    // y-monaco adds per-client class names; we colour and label them here.
    const style = document.createElement('style');
    document.head.appendChild(style);
    const renderCursors = () => {
      let css = '';
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        const remote = state.user as { name?: unknown; color?: unknown } | undefined;
        // Awareness state comes from other browsers: never trust it inside CSS.
        const color =
          typeof remote?.color === 'string' && HEX_COLOR.test(remote.color) ? remote.color : '#a1a1aa';
        const name = typeof remote?.name === 'string' ? remote.name.slice(0, 40) : 'Anonymous';
        css += `
          .yRemoteSelection-${clientId} { background-color: ${color}40; }
          .yRemoteSelectionHead-${clientId} {
            position: absolute; height: 100%; box-sizing: border-box;
            border-left: 2px solid ${color};
          }
          .yRemoteSelectionHead-${clientId}::after {
            content: ${JSON.stringify(name)};
            position: absolute; top: -1.35em; left: -2px; padding: 0 4px;
            border-radius: 3px 3px 3px 0; white-space: nowrap; pointer-events: none;
            font: 600 10px/1.4 ui-sans-serif, system-ui; color: #09090b; background: ${color};
          }`;
      });
      style.textContent = css;
    };
    awareness.on('change', renderCursors);

    return () => {
      awareness.off('change', renderCursors);
      provider.off('status', onStatus);
      binding.destroy();
      provider.destroy();
      doc.destroy();
      style.remove();
      docRef.current = null;
    };
  }, [roomId, editor, userId, userName]);

  /** The code to run: read from the CRDT, which is what everyone sees. */
  const getCode = useCallback(
    () => docRef.current?.getText(YDOC_TEXT_KEY).toString() ?? editor?.getValue() ?? '',
    [editor],
  );

  return { status, getCode };
}
