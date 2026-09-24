import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/Spinner';
import { errorMessage } from '../lib/errors';
import { safeNext } from '../lib/links';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') await signup({ name, email, password });
      else await login({ email, password });
      navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';
  const otherLink = `${isSignup ? '/login' : '/signup'}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 font-mono text-sm">
            &lt;/&gt;
          </div>
          <h1 className="text-2xl font-semibold">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-zinc-400">Code together. Run it safely.</p>
        </div>
        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          {isSignup && (
            <label className="block space-y-1.5">
              <span className="text-sm text-zinc-300">Name</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={60}
                autoComplete="name"
              />
            </label>
          )}
          <label className="block space-y-1.5">
            <span className="text-sm text-zinc-300">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-zinc-300">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isSignup ? 8 : 1}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
            />
            {isSignup && <span className="text-xs text-zinc-500">At least 8 characters</span>}
          </label>
          {error && (
            <p role="alert" className="rounded-md bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}
          <button type="submit" className="btn-primary w-full py-2" disabled={busy}>
            {busy && <Spinner />}
            {isSignup ? 'Sign up' : 'Log in'}
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-400">
          {isSignup ? 'Already have an account?' : 'New here?'}{' '}
          <Link to={otherLink} className="text-indigo-400 hover:underline">
            {isSignup ? 'Log in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </div>
  );
}
