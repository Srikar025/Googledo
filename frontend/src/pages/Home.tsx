import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'

export default function Home() {
  const navigate = useNavigate()
  const [joinId, setJoinId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // Create a brand-new document → navigate to its editor
  const handleCreate = async () => {
    setCreating(true)
    setError('')
    try {
      const { data } = await axios.post('/api/documents')
      navigate(`/editor/${data.id}`)
    } catch {
      setError('Failed to create document. Is the backend running?')
      setCreating(false)
    }
  }

  // Join an existing document by pasted ID
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault()
    const id = joinId.trim()
    if (!id) return
    navigate(`/editor/${id}`)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at 60% 0%, rgba(99,102,241,0.15) 0%, #0f1117 60%)' }}>

      {/* Logo / Hero */}
      <div className="mb-12 text-center">
        <div className="inline-flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
            ✦
          </div>
          <span className="text-3xl font-bold tracking-tight"
            style={{ fontFamily: 'Outfit, sans-serif' }}>
            CollabDocs
          </span>
        </div>
        <h1 className="text-5xl font-bold mb-4 leading-tight"
          style={{ fontFamily: 'Outfit, sans-serif' }}>
          Write together,{' '}
          <span style={{ background: 'linear-gradient(90deg, #6366f1, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            in real time
          </span>
        </h1>
        <p className="text-lg max-w-md mx-auto" style={{ color: '#8b93a8' }}>
          A collaborative rich-text editor powered by CRDTs. No conflicts, no overwriting — just seamless co-authoring.
        </p>
      </div>

      {/* Cards */}
      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl">

        {/* Create new */}
        <div className="flex-1 rounded-2xl p-8 flex flex-col gap-4"
          style={{ background: '#1e2535', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-4xl">📄</div>
          <h2 className="text-xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>New Document</h2>
          <p style={{ color: '#8b93a8', fontSize: '0.9rem' }}>
            Start a fresh document. Share the link with anyone to collaborate instantly.
          </p>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="mt-auto w-full py-3 rounded-xl font-semibold text-white transition-all duration-200 cursor-pointer"
            style={{
              background: creating ? '#3d4065' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: creating ? 'none' : '0 0 20px rgba(99,102,241,0.4)',
            }}>
            {creating ? 'Creating…' : '+ Create Document'}
          </button>
        </div>

        {/* Join existing */}
        <div className="flex-1 rounded-2xl p-8 flex flex-col gap-4"
          style={{ background: '#1e2535', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-4xl">🔗</div>
          <h2 className="text-xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Join Document</h2>
          <p style={{ color: '#8b93a8', fontSize: '0.9rem' }}>
            Have a document ID? Paste it below to jump straight into the editor.
          </p>
          <form onSubmit={handleJoin} className="mt-auto flex flex-col gap-3">
            <input
              type="text"
              placeholder="Paste document ID…"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl outline-none text-sm transition-all duration-200"
              style={{
                background: '#0f1117',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#f0f2f8',
              }}
            />
            <button
              type="submit"
              className="w-full py-3 rounded-xl font-semibold transition-all duration-200 cursor-pointer"
              style={{
                background: 'transparent',
                border: '1px solid rgba(99,102,241,0.6)',
                color: '#a5b4fc',
              }}>
              Join →
            </button>
          </form>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="mt-6 text-sm px-4 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
          {error}
        </p>
      )}

      {/* Footer */}
      <p className="mt-16 text-xs" style={{ color: '#4b5568' }}>
        Built with Yjs · Socket.io · React · Supabase
      </p>
    </div>
  )
}
