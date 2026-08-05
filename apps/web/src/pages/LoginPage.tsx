import { useState } from 'react';
import { Form, Input, Button, App } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useAuth } from '@/store/useAuth';
import { authLogin, authRegister, isValidUsername, AuthError } from '@/api/auth';
import { pullOnLogin } from '@/api/realtimeSync';

export default function LoginPage() {
  const { message } = App.useApp();
  const setAuth = useAuth((s) => s.setAuth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function doLogin() {
    setError('');
    if (!username) return setError('请输入用户名');
    if (!password) return setError('请输入密码');
    if (!isValidUsername(username)) return setError('用户名只能包含中文、英文、数字、下划线、连字符');

    setLoading(true);
    try {
      await authLogin(username, password, '');
      await onAuthSuccess(username, password);
      message.success(`欢迎回来，${username}！`);
    } catch (e) {
      if (e instanceof AuthError && e.status === 404) {
        const ok = window.confirm(`用户「${username}」不存在。\n\n要用这个密码注册新账号吗？`);
        if (ok) {
          await doRegister(username, password);
        } else {
          setError('请换一个用户名或点"注册"');
        }
      } else if (e instanceof AuthError && e.status === 401) {
        setError('❌ 密码错误');
      } else {
        setError('登录失败：' + (e instanceof Error ? e.message : '未知错误'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function doRegister(u?: string, p?: string) {
    const usernameVal = u ?? username;
    const passwordVal = p ?? password;
    setError('');
    if (!usernameVal || !passwordVal) return setError('请填写用户名和密码');
    if (passwordVal.length < 4) return setError('密码至少 4 位');
    if (!isValidUsername(usernameVal)) return setError('用户名只能包含中文、英文、数字、下划线、连字符');

    setLoading(true);
    try {
      await authRegister(usernameVal, passwordVal, '');
      await onAuthSuccess(usernameVal, passwordVal);
      message.success(`账号「${usernameVal}」注册成功！`);
    } catch (e) {
      if (e instanceof AuthError && e.status === 409) {
        setError('用户名已被占用，请换一个');
      } else {
        setError('注册失败：' + (e instanceof Error ? e.message : '未知错误'));
      }
    } finally {
      setLoading(false);
    }
  }

  async function onAuthSuccess(u: string, p: string) {
    setAuth(u, p);
    try {
      const result = await pullOnLogin();
      console.info('[sync] login pull merged', result.merged);
    } catch (e) {
      message.warning(
        '登录成功，但词库同步失败：' + (e instanceof Error ? e.message : '请稍后在设置里手动拉取')
      );
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48 }}>🔐</div>
          <h1 style={{ fontSize: 24, margin: '8px 0' }}>登录 / 注册</h1>
          <p style={{ color: 'var(--text-light)', margin: 0, fontSize: 14 }}>
            自动增量同步 · 改笔记/近义即上云
          </p>
        </div>

        <Form layout="vertical" onFinish={doLogin}>
          <Form.Item label="用户名">
            <Input
              prefix={<UserOutlined />}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="如：alice 或 我的名字"
              maxLength={32}
              autoComplete="username"
            />
          </Form.Item>
          <Form.Item
            label="密码"
            extra={
              <span style={{ fontSize: 12, color: 'var(--text-light)' }}>
                密码同时作为同步加密密钥，多设备要用同一密码
              </span>
            }
          >
            <Input.Password
              prefix={<LockOutlined />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 4 位"
              autoComplete="current-password"
            />
          </Form.Item>

          {error && (
            <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12, minHeight: 20 }}>
              {error}
            </div>
          )}

          <Button type="primary" htmlType="submit" block loading={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
          <Button type="text" block style={{ marginTop: 8 }} onClick={() => doRegister()} disabled={loading}>
            没账号？注册新账号
          </Button>
        </Form>

        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          • 服务端只存密码哈希；词数据按行存库并自动同步<br />
          • 老用户可在设置里「从 CloudBase 导入」
        </div>
      </div>
    </div>
  );
}
