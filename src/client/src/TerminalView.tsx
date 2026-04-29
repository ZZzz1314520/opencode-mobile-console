import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Session } from './api';

type TerminalViewProps = {
  session: Session;
  onLogout: () => void;
};

type ConversationPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; title: string; output?: string };

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  timeCreated: number;
  parts: ConversationPart[];
};

type ConversationSnapshot = {
  type: 'conversation';
  sessionId?: string;
  title?: string;
  messages: ConversationMessage[];
};

type SessionSummary = {
  id: string;
  title: string;
  timeCreated: number;
  timeUpdated: number;
  isControlled: boolean;
  isViewing: boolean;
};

type SessionsSnapshot = {
  type: 'sessions';
  controlledSessionId?: string;
  viewingSessionId?: string;
  sessions: SessionSummary[];
};

type OpenCodeStatus = {
  type: 'status';
  mode?: string;
  model?: string;
  selectedModel?: string;
  selectedAgent?: 'plan' | 'build';
  draftNewSession?: boolean;
  running?: boolean;
  cwd: string;
  contextTokens?: number;
  currentSessionId?: string;
  currentSessionTitle?: string;
};

type ServerMessage =
  | { type: 'hello'; role: Session['role'] }
  | ConversationSnapshot
  | SessionsSnapshot
  | OpenCodeStatus
  | { type: 'error'; message: string }
  | { type: 'pong' };

type ClientAction = 'new-session' | 'interrupt';

const SLASH_COMMANDS = ['/init', '/compact', '/undo', '/redo', '/help'];
const MODEL_OPTIONS = ['', 'openai/gpt-5.5'];
const ACTIONS: Array<{ label: string; action: ClientAction }> = [
  { label: '新 Session', action: 'new-session' },
  { label: '中断 Ctrl+C', action: 'interrupt' }
];

function websocketUrl(token: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

function formatTokens(value?: number): string {
  if (!value) return '未知';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

export function TerminalView({ session, onLogout }: TerminalViewProps) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [notice, setNotice] = useState('');
  const [line, setLine] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [conversation, setConversation] = useState<ConversationSnapshot>({ type: 'conversation', messages: [] });
  const [sessions, setSessions] = useState<SessionsSnapshot>({ type: 'sessions', sessions: [] });
  const [opencodeStatus, setOpenCodeStatus] = useState<OpenCodeStatus>({ type: 'status', cwd: '' });
  const canControl = session.role === 'controller';
  const viewingControlledSession = !conversation.sessionId || conversation.sessionId === sessions.controlledSessionId;
  const controlledSession = sessions.sessions.find((item) => item.id === sessions.controlledSessionId);

  useLayoutEffect(() => {
    const chat = chatRef.current;
    if (!chat) return;
    const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
    if (distanceFromBottom < 120) chat.scrollTop = chat.scrollHeight;
  }, [conversation]);

  useEffect(() => {
    let closedByEffect = false;

    function connect() {
      setStatus('connecting');
      const socket = new WebSocket(websocketUrl(session.token));
      socketRef.current = socket;

      socket.addEventListener('open', () => {
        setStatus('connected');
        setNotice('');
      });

      socket.addEventListener('message', (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === 'conversation') {
          setConversation(message);
          return;
        }
        if (message.type === 'sessions') {
          setSessions(message);
          return;
        }
        if (message.type === 'status') {
          setOpenCodeStatus(message);
          return;
        }
        if (message.type === 'error') setNotice(message.message);
      });

      socket.addEventListener('close', () => {
        if (closedByEffect) return;
        setStatus('disconnected');
        reconnectTimerRef.current = window.setTimeout(connect, 1500);
      });
    }

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      socketRef.current?.close();
    };
  }, [session.token]);

  function sendPayload(payload: unknown) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function sendInput(data: string) {
    if (!canControl) return;
    sendPayload({ type: 'input', data });
  }

  function runAction(action: ClientAction) {
    if (!canControl) return;
    sendPayload({ type: 'action', action });
    setActionsOpen(false);
    setDrawerOpen(false);
  }

  function setModel(model: string) {
    sendPayload({ type: 'set-model', model: model || undefined });
    setModelOpen(false);
  }

  function setAgent(agent: 'plan' | 'build') {
    sendPayload({ type: 'set-agent', agent });
  }

  function submitLine() {
    if (!line) {
      sendInput('\r');
      return;
    }
    sendInput(`${line}\r`);
    setLine('');
  }

  function insertNewLine() {
    setLine((current) => `${current}\n`);
  }

  function pickSlashCommand(command: string) {
    setLine((current) => (current ? `${current} ${command}` : command));
    setCommandOpen(false);
  }

  function viewSession(sessionId: string) {
    sendPayload({ type: 'view-session', sessionId });
    setDrawerOpen(false);
  }

  return (
    <main className="terminal-page mobile-console">
      <header className="console-topbar">
        <div className="top-row">
          <span className={`status ${status}`}>{status === 'connected' ? '已连接' : status === 'connecting' ? '连接中' : '重连中'}</span>
          <span className={`role ${session.role}`}>{canControl ? '控制模式' : '只读模式'}</span>
          <button className="ghost" onClick={onLogout}>退出</button>
        </div>
        <div className="status-grid">
          <div><span>模式</span><strong>{opencodeStatus.selectedAgent || opencodeStatus.mode || '未知'}</strong></div>
          <div><span>模型</span><strong>{opencodeStatus.selectedModel || opencodeStatus.model || '默认'}</strong></div>
          <div><span>状态</span><strong>{opencodeStatus.running ? '运行中' : formatTokens(opencodeStatus.contextTokens)}</strong></div>
        </div>
        <div className="path-line">{opencodeStatus.cwd || '等待 OpenCode 状态...'}</div>
        <div className={viewingControlledSession ? 'control-hint ok' : 'control-hint warn'}>
          控制：{opencodeStatus.draftNewSession ? '新 Session 草稿' : controlledSession?.title || opencodeStatus.currentSessionTitle || '未知'}
          {viewingControlledSession ? '' : ' · 当前查看的是历史，输入仍会发送到当前控制会话'}
        </div>
        <div className="top-actions">
          <button onClick={() => runAction('new-session')} disabled={!canControl}>新 Session</button>
          <button className="secondary" onClick={() => setDrawerOpen(true)}>Sessions</button>
        </div>
      </header>

      {notice ? <div className="notice">{notice}</div> : null}

      <section className="conversation-screen console-chat" ref={chatRef}>
        {conversation.title ? <div className="conversation-title">{conversation.title}</div> : null}
        {conversation.messages.length === 0 ? (
          <div className="empty-history">暂无 OpenCode 会话记录</div>
        ) : (
          conversation.messages.map((message) => (
            <article className={`chat-message ${message.role}`} key={message.id}>
              <div className="chat-role">{message.role === 'user' ? '你' : 'AI'}</div>
              <div className="chat-parts">
                {message.parts.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <div className="chat-text markdown-body" key={index}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                      </div>
                    );
                  }
                  if (part.type === 'reasoning') {
                    return (
                      <details className="chat-reasoning" key={index}>
                        <summary>思考</summary>
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text}</ReactMarkdown>
                        </div>
                      </details>
                    );
                  }
                  return (
                    <details className="chat-tool" key={index}>
                      <summary>{part.title}</summary>
                      {part.output ? <pre>{part.output}</pre> : null}
                    </details>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </section>

      {drawerOpen ? (
        <aside className="session-drawer">
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="drawer-panel">
            <div className="drawer-head">
              <strong>Sessions</strong>
              <button className="ghost" onClick={() => setDrawerOpen(false)}>关闭</button>
            </div>
            <div className="session-list">
              {sessions.sessions.map((item) => (
                <button
                  className={`session-card ${item.id === sessions.viewingSessionId ? 'active' : ''}`}
                  key={item.id}
                  onClick={() => viewSession(item.id)}
                >
                  <strong>{item.title}</strong>
                  <span>{formatTime(item.timeUpdated)}</span>
                  <small>{item.isControlled ? '当前控制' : item.isViewing ? '当前查看' : '点击查看历史'}</small>
                </button>
              ))}
            </div>
          </div>
        </aside>
      ) : null}

      {commandOpen || actionsOpen || modelOpen ? (
        <div className="sheet-backdrop" onClick={() => { setCommandOpen(false); setActionsOpen(false); setModelOpen(false); }}>
          <div className="bottom-sheet" onClick={(event) => event.stopPropagation()}>
            {commandOpen ? (
              <>
                <strong>/ 命令</strong>
                <div className="sheet-grid">
                  {SLASH_COMMANDS.map((command) => <button key={command} onClick={() => pickSlashCommand(command)}>{command}</button>)}
                </div>
              </>
            ) : null}
            {actionsOpen ? (
              <>
                <strong>更多操作</strong>
                <div className="sheet-grid">
                  <button onClick={() => { setActionsOpen(false); setModelOpen(true); }}>切换模型</button>
                  <button onClick={() => setAgent('plan')}>Plan 模式</button>
                  <button onClick={() => setAgent('build')}>Build 模式</button>
                  {ACTIONS.map((item) => <button key={item.action} onClick={() => runAction(item.action)}>{item.label}</button>)}
                  <button onClick={() => { setLine(''); setActionsOpen(false); }}>清空输入</button>
                </div>
              </>
            ) : null}
            {modelOpen ? (
              <>
                <strong>切换模型</strong>
                <div className="sheet-grid">
                  {MODEL_OPTIONS.map((model) => <button key={model || 'default'} onClick={() => setModel(model)}>{model || '默认模型'}</button>)}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {canControl ? (
        <footer className="control-panel console-input">
          <div className="input-row">
            <textarea
              value={line}
              onChange={(event) => setLine(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submitLine();
                }
              }}
              placeholder="输入内容会发送到当前控制会话。Ctrl+Enter 发送；手机可点发送或换行。"
            />
          </div>
          <div className="console-command-row">
            <button className="secondary" onClick={() => setCommandOpen(true)}>/ 命令</button>
            <button className="secondary" onClick={() => setActionsOpen(true)}>更多</button>
          </div>
          <div className="send-actions">
            <button onClick={submitLine} disabled={opencodeStatus.running}>发送</button>
            <button className="secondary" onClick={insertNewLine}>换行</button>
          </div>
        </footer>
      ) : (
        <footer className="readonly-panel">只读模式：你可以查看会话历史，但不能操作主机端 OpenCode。</footer>
      )}
    </main>
  );
}
