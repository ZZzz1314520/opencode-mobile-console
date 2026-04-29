import { useEffect, useState } from 'react';
import { Login } from './Login';
import { TerminalView } from './TerminalView';
import type { Session } from './api';

const storageKey = 'opencode-share-session';

export function App() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return;
    try {
      setSession(JSON.parse(raw) as Session);
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  function handleLogin(nextSession: Session) {
    window.localStorage.setItem(storageKey, JSON.stringify(nextSession));
    setSession(nextSession);
  }

  function handleLogout() {
    window.localStorage.removeItem(storageKey);
    setSession(null);
  }

  if (!session) {
    return <Login onLogin={handleLogin} />;
  }

  return <TerminalView session={session} onLogout={handleLogout} />;
}
