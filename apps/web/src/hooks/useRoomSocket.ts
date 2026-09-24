import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  PresenceUser,
  RoomUpdatedPayload,
  RunUpdateEvent,
  ServerToClientEvents,
} from '@codesync/shared';
import { API_URL } from '../lib/config';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Handlers {
  onRunUpdate: (event: RunUpdateEvent) => void;
  onRoomUpdated: (event: RoomUpdatedPayload) => void;
}

/** Socket.IO channel for app events: run status, presence, room settings. */
export function useRoomSocket(roomId: string | null, handlers: Handlers) {
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!roomId) return;
    const opts = { withCredentials: true, transports: ['websocket'] };
    const socket: ClientSocket = API_URL ? io(API_URL, opts) : io(opts);

    socket.on('connect', () => {
      setConnected(true);
      // Re-join on every (re)connect: the server forgets rooms when a socket drops.
      socket.emit('room:join', { roomId }, (ack) => {
        if (!ack.ok) console.warn('room:join failed:', ack.error);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('room:presence', (payload) => setPresence(payload.users));
    socket.on('run:update', (event) => handlersRef.current.onRunUpdate(event));
    socket.on('room:updated', (event) => handlersRef.current.onRoomUpdated(event));

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  return { connected, presence };
}
