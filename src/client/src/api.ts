export type Role = 'viewer' | 'controller';

export type Session = {
  token: string;
  role: Role;
};

export async function login(password: string): Promise<Session> {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });

  if (!response.ok) {
    throw new Error('密码错误');
  }

  return (await response.json()) as Session;
}
