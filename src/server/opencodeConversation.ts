import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

export type ConversationPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; title: string; output?: string };

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  timeCreated: number;
  parts: ConversationPart[];
};

export type ConversationSnapshot = {
  type: 'conversation';
  sessionId?: string;
  title?: string;
  messages: ConversationMessage[];
};

export type SessionSummary = {
  id: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
  isControlled: boolean;
  isViewing: boolean;
};

export type SessionsSnapshot = {
  type: 'sessions';
  controlledSessionId?: string;
  viewingSessionId?: string;
  sessions: SessionSummary[];
};

export type OpenCodeStatus = {
  type: 'status';
  mode?: string;
  model?: string;
  cwd: string;
  contextTokens?: number;
  currentSessionId?: string;
  currentSessionTitle?: string;
};

type SessionRow = {
  id: string;
  title: string;
  time_created: number;
  time_updated: number;
};

type MessageRow = {
  id: string;
  time_created: number;
  data: string;
};

type PartRow = {
  message_id: string;
  time_created: number;
  data: string;
};

type MessageData = {
  role?: string;
  mode?: string;
  modelID?: string;
  tokens?: { total?: number };
  path?: { cwd?: string };
};

type PartData = {
  type?: string;
  text?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    title?: string;
    metadata?: { output?: string; description?: string };
  };
};

export class OpenCodeConversationReader {
  private readonly dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  private controlledSessionId: string | undefined;
  private viewingSessionId: string | undefined;

  constructor(private readonly cwd: string, private readonly startedAt: number) {}

  getViewingSessionId(): string | undefined {
    return this.viewingSessionId || this.controlledSessionId;
  }

  getControlledSessionId(): string | undefined {
    return this.controlledSessionId;
  }

  setViewingSession(sessionId: string): void {
    this.viewingSessionId = sessionId;
  }

  setControlledSession(sessionId: string): void {
    this.controlledSessionId = sessionId;
    this.viewingSessionId = sessionId;
  }

  clearControlledSession(): void {
    this.controlledSessionId = undefined;
    this.viewingSessionId = undefined;
  }

  refreshControlledSession(): void {
    this.withDb((db) => {
      this.findControlledSession(db, true);
    }, undefined);
  }

  adoptNewSessionAfter(after: number, previousSessionId?: string): boolean {
    const session = this.findLatestSessionAfter(after, previousSessionId);
    if (!session) return false;
    this.controlledSessionId = session.id;
    this.viewingSessionId = session.id;
    return true;
  }

  findLatestSessionAfter(after: number, previousSessionId?: string): SessionRow | undefined {
    return this.withDb((db) => {
      const session = db
        .prepare('select id, title, time_created, time_updated from session where directory = ? and time_created >= ? order by time_updated desc limit 1')
        .get(this.cwd, after) as SessionRow | undefined;
      if (!session || session.id === previousSessionId) return undefined;
      return session;
    }, undefined);
  }

  readConversation(sessionId = this.getViewingSessionId()): ConversationSnapshot {
    return this.withDb((db) => {
      const session = this.findSession(db, sessionId);
      if (!session) return { type: 'conversation', messages: [] };
      this.viewingSessionId = session.id;

      const messages = db
        .prepare('select id, time_created, data from message where session_id = ? order by time_created, id')
        .all(session.id) as MessageRow[];
      const parts = db
        .prepare('select message_id, time_created, data from part where session_id = ? order by time_created, id')
        .all(session.id) as PartRow[];

      return {
        type: 'conversation',
        sessionId: session.id,
        title: session.title,
        messages: buildMessages(messages, parts)
      };
    }, { type: 'conversation', messages: [] });
  }

  readSessions(ensureControlled = true): SessionsSnapshot {
    return this.withDb((db) => {
      const controlled = ensureControlled ? this.findControlledSession(db) : this.findControlledSessionById(db);
      const sessions = db
        .prepare('select id, title, time_created, time_updated from session where directory = ? order by time_updated desc limit 80')
        .all(this.cwd) as SessionRow[];
      if (!this.viewingSessionId) this.viewingSessionId = controlled?.id || sessions[0]?.id;

      return {
        type: 'sessions',
        controlledSessionId: controlled?.id,
        viewingSessionId: this.viewingSessionId,
        sessions: sessions.map((session) => ({
          id: session.id,
          title: session.title || 'Untitled session',
          timeCreated: session.time_created,
          timeUpdated: session.time_updated,
          isControlled: session.id === controlled?.id,
          isViewing: session.id === this.viewingSessionId
        }))
      };
    }, { type: 'sessions', sessions: [] } as SessionsSnapshot);
  }

  readStatus(): OpenCodeStatus {
    return this.withDb((db) => {
      const controlled = this.findControlledSession(db);
      if (!controlled) return { type: 'status', cwd: this.cwd };

      const rows = db
        .prepare('select id, time_created, data from message where session_id = ? order by time_created desc, id desc limit 20')
        .all(controlled.id) as MessageRow[];
      const latestAssistant = rows.map((row) => parseJson<MessageData>(row.data)).find((data) => data?.role === 'assistant');

      return {
        type: 'status',
        mode: latestAssistant?.mode,
        model: latestAssistant?.modelID,
        cwd: latestAssistant?.path?.cwd || this.cwd,
        contextTokens: latestAssistant?.tokens?.total,
        currentSessionId: controlled.id,
        currentSessionTitle: controlled.title
      };
    }, { type: 'status', cwd: this.cwd });
  }

  private findSession(db: Database.Database, sessionId?: string): SessionRow | undefined {
    if (sessionId) {
      const selected = db.prepare('select id, title, time_created, time_updated from session where id = ?').get(sessionId) as SessionRow | undefined;
      if (selected) return selected;
      this.viewingSessionId = undefined;
    }
    return this.findControlledSession(db) || this.findNewestSession(db);
  }

  private findControlledSession(db: Database.Database, preferNew = false): SessionRow | undefined {
    if (this.controlledSessionId && !preferNew) {
      const locked = db
        .prepare('select id, title, time_created, time_updated from session where id = ?')
        .get(this.controlledSessionId) as SessionRow | undefined;
      if (locked) return locked;
      this.controlledSessionId = undefined;
    }

    const recent = db
      .prepare('select id, title, time_created, time_updated from session where directory = ? and time_created >= ? order by time_created desc limit 1')
      .get(this.cwd, this.startedAt - 30000) as SessionRow | undefined;
    if (recent) {
      this.controlledSessionId = recent.id;
      this.viewingSessionId = recent.id;
      return recent;
    }

    const fallback = this.findNewestSession(db);
    if (fallback) this.controlledSessionId = fallback.id;
    return fallback;
  }

  private findControlledSessionById(db: Database.Database): SessionRow | undefined {
    if (!this.controlledSessionId) return undefined;
    return db
      .prepare('select id, title, time_created, time_updated from session where id = ?')
      .get(this.controlledSessionId) as SessionRow | undefined;
  }

  private findNewestSession(db: Database.Database): SessionRow | undefined {
    return db
      .prepare('select id, title, time_created, time_updated from session where directory = ? order by time_created desc limit 1')
      .get(this.cwd) as SessionRow | undefined;
  }

  private withDb<T>(read: (db: Database.Database) => T, fallback: T): T {
    let db: Database.Database | undefined;
    try {
      db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      return read(db);
    } catch {
      return fallback;
    } finally {
      db?.close();
    }
  }
}

function buildMessages(messages: MessageRow[], parts: PartRow[]): ConversationMessage[] {
  const messageRoles = new Map<string, ConversationMessage>();

  for (const message of messages) {
    const data = parseJson<MessageData>(message.data);
    if (data?.role !== 'user' && data?.role !== 'assistant') continue;
    messageRoles.set(message.id, {
      id: message.id,
      role: data.role,
      timeCreated: message.time_created,
      parts: []
    });
  }

  for (const part of parts) {
    const message = messageRoles.get(part.message_id);
    if (!message) continue;
    const parsed = parsePart(part.data);
    if (parsed) message.parts.push(parsed);
  }

  return [...messageRoles.values()].filter((message) => message.parts.length > 0);
}

function parsePart(data: string): ConversationPart | undefined {
  const part = parseJson<PartData>(data);
  if (!part?.type) return undefined;

  if (part.type === 'text' && part.text?.trim()) {
    const text = cleanTextPart(part.text);
    return text ? { type: 'text', text } : undefined;
  }

  if (part.type === 'reasoning' && part.text?.trim()) {
    const text = cleanTextPart(part.text);
    return text ? { type: 'reasoning', text } : undefined;
  }

  if (part.type === 'tool') {
    const title = part.state?.title || part.state?.metadata?.description || part.tool || '工具调用';
    const output = part.state?.output || part.state?.metadata?.output;
    return { type: 'tool', title, output: output ? trimToolOutput(output) : undefined };
  }

  return undefined;
}

function trimToolOutput(output: string): string {
  const text = output.trim();
  if (text.length <= 1200) return text;
  return `${text.slice(0, 1200)}\n...`;
}

function cleanTextPart(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<system-reminder>[\s\S]*$/g, '')
    .replace(/^Note: The user selected line .*$/gm, '')
    .trim();
}

function parseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
