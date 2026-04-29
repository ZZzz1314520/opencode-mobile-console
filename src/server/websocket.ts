import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { AppConfig } from './config.js';
import { verifyToken, type Role } from './auth.js';
import type { SharedTerminal } from './terminal.js';
import { OpenCodeConversationReader, type ConversationSnapshot } from './opencodeConversation.js';

type ClientAction = 'new-session' | 'interrupt';

type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'action'; action: ClientAction }
  | { type: 'view-session'; sessionId: string }
  | { type: 'set-model'; model?: string }
  | { type: 'set-agent'; agent: 'plan' | 'build' }
  | { type: 'ping' };

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function tokenFromRequest(request: IncomingMessage): string | undefined {
  const url = new URL(request.url || '/', 'http://localhost');
  return url.searchParams.get('token') || undefined;
}

export function attachWebSocket(server: import('node:http').Server, terminal: SharedTerminal, config: AppConfig): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map<WebSocket, Role>();
  const conversationReader = new OpenCodeConversationReader(config.cwd, Date.now());
  let lastPayloadKey = '';
  let draftNewSession = false;
  let selectedModel: string | undefined;
  let selectedAgent: 'plan' | 'build' = 'build';

  function currentConversation(): ConversationSnapshot {
    if (draftNewSession) {
      return { type: 'conversation', title: '新 Session', messages: [] };
    }
    return conversationReader.readConversation();
  }

  function currentStatus() {
    const baseStatus = draftNewSession ? { type: 'status' as const, cwd: config.cwd } : conversationReader.readStatus();
    return {
      ...baseStatus,
      selectedModel,
      selectedAgent,
      draftNewSession,
      running: terminal.isRunning()
    };
  }

  function sendState(ws: WebSocket): void {
    send(ws, currentStatus());
    send(ws, conversationReader.readSessions(!draftNewSession));
    send(ws, currentConversation());
  }

  function broadcastState(force = false): void {
    if (!force && clients.size === 0) return;
    const status = currentStatus();
    const sessions = conversationReader.readSessions(!draftNewSession);
    const conversation = currentConversation();
    const key = JSON.stringify({ status, sessions, conversation });
    if (!force && key === lastPayloadKey) return;
    lastPayloadKey = key;

    for (const ws of clients.keys()) {
      send(ws, status);
      send(ws, sessions);
      send(ws, conversation);
    }
  }

  terminal.on('activity', () => broadcastState(true));

  wss.on('connection', (ws, request) => {
    const role = verifyToken(tokenFromRequest(request), config);
    if (!role) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    clients.set(ws, role);
    send(ws, { type: 'hello', role });
    sendState(ws);

    ws.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(ws, { type: 'error', message: 'Invalid message' });
        return;
      }

      if (message.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }

      if (message.type === 'view-session') {
        draftNewSession = false;
        conversationReader.setControlledSession(message.sessionId);
        broadcastState(true);
        return;
      }

      if (clients.get(ws) !== 'controller') {
        send(ws, { type: 'error', message: 'Readonly clients cannot control OpenCode' });
        return;
      }

      if (message.type === 'set-model') {
        selectedModel = message.model?.trim() || undefined;
        broadcastState(true);
        return;
      }

      if (message.type === 'set-agent') {
        selectedAgent = message.agent;
        broadcastState(true);
        return;
      }

      if (message.type === 'action') {
        if (message.action === 'new-session') {
          draftNewSession = true;
          conversationReader.clearControlledSession();
          broadcastState(true);
          return;
        }
        send(ws, { type: 'error', message: '当前架构不支持中断已经启动的 oc run 子进程' });
        return;
      }

      if (message.type === 'input') {
        const text = message.data.trim();
        if (!text) return;
        const startedAt = Date.now();
        const previousSessionId = conversationReader.getControlledSessionId();
        const sessionId = draftNewSession ? undefined : previousSessionId;

        terminal
          .runPrompt(text, { sessionId, model: selectedModel, agent: selectedAgent })
          .then(() => {
            if (draftNewSession || !sessionId) {
              conversationReader.adoptNewSessionAfter(startedAt - 1000, previousSessionId);
              draftNewSession = false;
            } else {
              conversationReader.setControlledSession(sessionId);
            }
            broadcastState(true);
          })
          .catch((error: Error) => {
            send(ws, { type: 'error', message: error.message });
            broadcastState(true);
          });
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  setInterval(() => broadcastState(), 1500);
}
