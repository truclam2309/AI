import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoaderCircleIcon } from 'lucide-react';
import { toApiError } from '../api/errors';
import { TextField } from '../components/TextField';
import { useAuth } from '../contexts/AuthContext';
import { AuthLayout } from '../layouts/AuthLayout';

export function Login() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as {from?: string} | null)?.from ?? '/';
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    setSubmitting(true);
    try {
      await login({ username_or_email: identity.trim(), password });
      navigate(from, { replace: true });
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold">Đăng nhập MyFit</h1>
      <p className="mt-1 text-sm text-muted">Tiếp tục theo dõi hồ sơ và thực đơn của bạn.</p>
      {message && <p role="alert" className="mt-5 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">{message}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <TextField
          label="Email hoặc tên đăng nhập"
          name="identity"
          autoComplete="username"
          value={identity}
          onChange={(event) => setIdentity(event.target.value)}
          required
        />
        <TextField
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" className="btn-primary h-11 w-full" disabled={submitting || !identity || !password}>
          {submitting && <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Đăng nhập
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Chưa có tài khoản? <Link to="/register" className="font-medium text-brand hover:underline">Đăng ký</Link>
      </p>
    </AuthLayout>
  );
}
