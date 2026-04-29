import { FormEvent, useState } from 'react';
import { login, type Session } from './api';

type LoginProps = {
  onLogin: (session: Session) => void;
};

export function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      onLogin(await login(password));
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div>
          <p className="eyebrow">LAN Terminal</p>
          <h1>OpenCode Share</h1>
          <p className="muted">输入只读密码或控制密码，连接这台 Windows 主机上的 oc 会话。</p>
        </div>

        <label>
          访问密码
          <input
            autoFocus
            inputMode="text"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
        </label>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={loading || !password}>
          {loading ? '连接中...' : '进入控制台'}
        </button>
      </form>
    </main>
  );
}
