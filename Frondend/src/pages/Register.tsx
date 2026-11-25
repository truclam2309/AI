import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LoaderCircleIcon } from 'lucide-react';
import { toApiError } from '../api/errors';
import { TextField } from '../components/TextField';
import { useAuth } from '../contexts/AuthContext';
import { AuthLayout } from '../layouts/AuthLayout';

export function Register() {
  const { register, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/profile';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') return <Navigate to="/profile" replace />;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');
    if (!username.trim() && !email.trim()) {
      setMessage('Hãy nhập email hoặc tên đăng nhập.');
      return;
    }
    if (password.length < 10) {
      setMessage('Mật khẩu cần có ít nhất 10 ký tự.');
      return;
    }
    setSubmitting(true);
    try {
      await register({
        ...(username.trim() ? { username: username.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        password
      });
      navigate(from, { replace: true });
    } catch (error) {
      setMessage(toApiError(error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold">Tạo tài khoản</h1>
      <p className="mt-1 text-sm text-muted">Đăng ký bằng email hoặc tên đăng nhập. Hồ sơ sức khỏe có thể bổ sung sau.</p>
      {message && <p role="alert" className="mt-5 rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent">{message}</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <TextField
          label="Tên đăng nhập (không bắt buộc nếu có email)"
          name="username"
          autoComplete="username"
          minLength={3}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <TextField
          label="Email (không bắt buộc nếu có tên đăng nhập)"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" className="btn-primary h-11 w-full" disabled={submitting}>
          {submitting && <LoaderCircleIcon className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Tạo tài khoản
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Đã có tài khoản? <Link to="/login" className="font-medium text-brand hover:underline">Đăng nhập</Link>
      </p>
    </AuthLayout>
  );
}
