import { useState } from 'react'
import { supabase, friendlyError } from '../../lib/supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [mode, setMode] = useState<'in' | 'forgot' | 'sent'>('in')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset` })
      setBusy(false)
      if (error) setErr(friendlyError(error)); else setMode('sent')
      return
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(friendlyError(error))
  }

  return (
    <div className="login-wrap">
      <form className="login" onSubmit={submit}>
        <div className="masthead">
          <div className="label">Laboratory register <span className="c-red">■</span></div>
          <h1 className="title-xl" style={{ fontSize: '2.6rem' }}>LabSync</h1>
          <p className="muted small">Stock · Blood bank · Cold chain · Tasks</p>
        </div>
        {mode === 'sent' ? (
          <div className="stack">
            <p>If an account exists for <b>{email}</b>, a reset link is on its way. If it doesn't arrive, ask your lab admin to reset your password from Settings → Staff.</p>
            <button type="button" className="btn" onClick={() => setMode('in')}>Back to sign in</button>
          </div>
        ) : (
          <>
            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {mode === 'in' && (
              <div className="field">
                <label className="label" htmlFor="pw">Password</label>
                <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            )}
            {err && <p className="banner critical" role="alert"><span className="b-body small">{err}</span></p>}
            <button className="btn primary block xl" disabled={busy}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Send reset link'}</button>
            <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setMode(mode === 'in' ? 'forgot' : 'in'); setErr('') }}>
              {mode === 'in' ? 'Forgot password?' : 'Back to sign in'}
            </button>
            <p className="small faint" style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
              Accounts are created by your lab director. No account? Ask them to add you.
            </p>
          </>
        )}
      </form>
    </div>
  )
}

export function ResetPassword() {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw.length < 8) return setMsg('Use at least 8 characters.')
    const { error } = await supabase.auth.updateUser({ password: pw })
    setMsg(error ? friendlyError(error) : 'Password updated. You can continue.')
    if (!error) setTimeout(() => location.assign('/'), 900)
  }
  return (
    <div className="login-wrap">
      <form className="login" onSubmit={save}>
        <div className="masthead"><div className="label">LabSync</div><h1 className="title-l">Set a new password</h1></div>
        <div className="field"><label className="label" htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {msg && <p className="small" style={{ marginBottom: 12 }}>{msg}</p>}
        <button className="btn primary block xl">Save password</button>
      </form>
    </div>
  )
}

export function NoLab({ inactive }: { inactive?: boolean }) {
  return (
    <div className="login-wrap">
      <div className="login">
        <div className="masthead"><div className="label">LabSync <span className="c-red">■</span></div><h1 className="title-l">{inactive ? 'Account paused' : 'Not linked to a lab yet'}</h1></div>
        <p style={{ marginBottom: 20 }}>{inactive
          ? 'Your account has been deactivated by your lab admin. Contact them to restore access.'
          : 'Your account exists but is not attached to a laboratory. Ask your lab director to add you from Settings → Staff.'}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  )
}
