import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as Y from 'yjs'
import Quill from 'quill'
import type { Op } from 'quill/core'
import { createPortal } from 'react-dom'
import api from '../lib/axios'
import EditorComponent from '../components/Editor'
import { getSocket, disconnectSocket } from '../sockets/socket'

// ── Manual Yjs ↔ Quill 2 Binding ───────────────────────────────────────────
// (y-quill only supports Quill 1.x — this is the Quill 2 compatible version)

function bindYjsToQuill(ydoc: Y.Doc, quill: Quill) {
  const ytext = ydoc.getText('quill')

  // ── Quill → Yjs ────────────────────────────────────────────────────────────
  // When the user types, translate the Quill Delta into Y.Text operations
  const onTextChange = (delta: { ops: Op[] }, _: unknown, source: string) => {
    if (source !== 'user') return

    ydoc.transact(() => {
      let index = 0
      for (const op of delta.ops) {
        if (typeof op.retain === 'number') {
          index += op.retain
        } else if (op.insert !== undefined) {
          const text = typeof op.insert === 'string' ? op.insert : '\uFFFC' // object embed placeholder
          const attrs = op.attributes as Record<string, unknown> | undefined
          ytext.insert(index, text, attrs)
          index += text.length
        } else if (typeof op.delete === 'number') {
          ytext.delete(index, op.delete)
        }
      }
    }, 'quill') // origin = 'quill' so we can ignore it in the Yjs observer
  }

  // ── Yjs → Quill ────────────────────────────────────────────────────────────
  // When a remote update changes Y.Text, apply the resulting delta to Quill
  const onYjsChange = (event: Y.YTextEvent) => {
    if (event.transaction.origin === 'quill') return // don't echo local changes

    // Y.Text delta is Quill-Delta-compatible
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quill.updateContents(event.delta as any, 'api')
  }


  quill.on('text-change', onTextChange)
  ytext.observe(onYjsChange)

  return () => {

    quill.off('text-change', onTextChange)
    ytext.unobserve(onYjsChange)
  }
}

function base64ToUint8Array(base64: string) {
  const binaryString = window.atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

interface PreviewEditorProps {
  content: string
}

function PreviewEditor({ content }: PreviewEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<Quill | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const doc = new Y.Doc()
    try {
      const update = base64ToUint8Array(content)
      Y.applyUpdate(doc, update)
    } catch (e) {
      console.error("Failed to decode version update content", e)
    }
    const text = doc.getText('quill')

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      readOnly: true,
      modules: {
        toolbar: false
      }
    })

    quill.setContents(text.toDelta() as any)
    quillRef.current = quill

    return () => {
      quillRef.current = null
      const container = containerRef.current
      if (container) {
        const toolbar = container.previousSibling
        if (toolbar && toolbar.nodeType === Node.ELEMENT_NODE && (toolbar as HTMLElement).classList.contains('ql-toolbar')) {
          container.parentNode?.removeChild(toolbar)
        }
      }
    }
  }, [content])

  return (
    <div className="quill-wrapper ql-container-preview">
      <div ref={containerRef} />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

interface Collaborator {
  socketId: string
  name: string
  color: string
  range: { index: number; length: number } | null
}

interface CursorVisual {
  socketId: string
  name: string
  color: string
  left: number
  top: number
  height: number
  visible: boolean
}

interface DbVersion {
  id: string
  name: string
  createdAt: string
  content?: string
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function EditorPage() {
  const { docId } = useParams<{ docId: string }>()
  const navigate = useNavigate()

  const quillRef = useRef<Quill | null>(null)
  const ydocRef = useRef<Y.Doc | null>(null)

  const [title] = useState('Untitled Document')
  const [copied, setCopied] = useState(false)
  const [connected, setConnected] = useState(false)
  const [collaborators, setCollaborators] = useState<Record<string, Collaborator>>({})
  const collaboratorsRef = useRef<Record<string, Collaborator>>({})

  const [editorContainer, setEditorContainer] = useState<HTMLDivElement | null>(null)
  const [visualCursors, setVisualCursors] = useState<Record<string, CursorVisual>>({})

  const [localUser, setLocalUser] = useState<{ name: string; color: string }>(() => {
    const saved = localStorage.getItem('collab-user')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch {}
    }
    const colors = [
      '#f87171', '#fb923c', '#fbbf24', '#34d399',
      '#60a5fa', '#818cf8', '#a78bfa', '#f472b6'
    ]
    const animals = [
      'Koala', 'Capybara', 'Panda', 'Lemur', 'Otter',
      'Axolotl', 'Fox', 'Rabbit', 'Badger', 'Dolphin'
    ]
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)]
    const randomColor = colors[Math.floor(Math.random() * colors.length)]
    const user = { name: `Anonymous ${randomAnimal}`, color: randomColor }
    localStorage.setItem('collab-user', JSON.stringify(user))
    return user
  })

  const localUserRef = useRef(localUser)
  localUserRef.current = localUser

  // ── Version History State & Handlers ───────────────────────────────────────
  const [versionHistoryMode, setVersionHistoryMode] = useState(false)
  const [versionsList, setVersionsList] = useState<DbVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<DbVersion | null>(null)
  const [savingVersion, setSavingVersion] = useState(false)
  const [showNameDialog, setShowNameDialog] = useState(false)
  const [newVersionName, setNewVersionName] = useState("")

  const fetchVersions = useCallback(async () => {
    if (!docId) return
    try {
      const { data } = await api.get(`/api/documents/${docId}/versions`)
      setVersionsList(data)
    } catch (e) {
      console.error("Failed to fetch versions list:", e)
    }
  }, [docId])

  const handleSaveVersion = async (name?: string) => {
    if (!docId) return
    setSavingVersion(true)
    try {
      await api.post(`/api/documents/${docId}/versions`, { name })
      await fetchVersions()
      setShowNameDialog(false)
      setNewVersionName("")
    } catch (e) {
      console.error("Failed to save version snapshot:", e)
    } finally {
      setSavingVersion(false)
    }
  }

  const handleSelectVersion = async (versionId: string) => {
    try {
      const { data } = await api.get(`/api/documents/${docId}/versions/${versionId}`)
      setSelectedVersion(data)
    } catch (e) {
      console.error("Failed to load version content:", e)
    }
  }

  const handleRestoreVersion = async () => {
    if (!selectedVersion || !quillRef.current || !ydocRef.current) return
    try {
      const update = base64ToUint8Array(selectedVersion.content!)
      const targetDoc = new Y.Doc()
      Y.applyUpdate(targetDoc, update)
      const targetText = targetDoc.getText("quill")
      const currentText = ydocRef.current.getText("quill")
      const delta = targetText.toDelta()

      ydocRef.current.transact(() => {
        currentText.delete(0, currentText.length)
        let index = 0
        for (const op of delta) {
          if (op.insert) {
            const text = typeof op.insert === "string" ? op.insert : "\uFFFC"
            currentText.insert(index, text, op.attributes)
            index += text.length
          }
        }
      }, "restore")

      // Close preview mode
      setVersionHistoryMode(false)
      setSelectedVersion(null)
    } catch (e) {
      console.error("Failed to restore version:", e)
    }
  }

  // Helper to update collaborators state + ref concurrently
  const updateCollaborators = useCallback((newCollabs: Record<string, Collaborator> | ((prev: Record<string, Collaborator>) => Record<string, Collaborator>)) => {
    setCollaborators((prev) => {
      const next = typeof newCollabs === 'function' ? newCollabs(prev) : newCollabs
      collaboratorsRef.current = next
      return next
    })
  }, [])

  // Calculate visual cursor bounds for all active collaborators
  const updateVisualCursors = useCallback(() => {
    if (!quillRef.current) return
    const quill = quillRef.current
    const currentCollaborators = collaboratorsRef.current
    const newVisuals: Record<string, CursorVisual> = {}

    Object.entries(currentCollaborators).forEach(([socketId, col]) => {
      if (!col.range) return
      try {
        const bounds = quill.getBounds(col.range.index)
        if (bounds) {
          newVisuals[socketId] = {
            socketId,
            name: col.name,
            color: col.color,
            left: bounds.left,
            top: bounds.top,
            height: bounds.height,
            visible: true,
          }
        }
      } catch (e) {
        // Safe to ignore if out of range temporarily
      }
    })

    setVisualCursors(newVisuals)
  }, [])

  // Local user name updater
  const handleUpdateName = (newName: string) => {
    const updated = { ...localUser, name: newName }
    setLocalUser(updated)
    localStorage.setItem('collab-user', JSON.stringify(updated))
    const socket = getSocket()
    if (socket && connected && docId) {
      socket.emit('update-user-info', docId, updated)
    }
  }

  // ── Socket connection lifecycle ────────────────────────────────────────────
  useEffect(() => {
    if (!docId) return
    const socket = getSocket()

    const onConnect = () => {
      setConnected(true)
      socket.emit('join-document', docId, localUserRef.current)
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', () => setConnected(false))

    // Set connected directly if already connected
    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect')
      disconnectSocket()
    }
  }, [docId])

  // Recalculate visual cursors when resize event occurs
  useEffect(() => {
    const handleResize = () => {
      updateVisualCursors()
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [updateVisualCursors])

  // ── Called by Editor component once Quill is mounted ──────────────────────
  const handleEditorReady = useCallback((quill: Quill) => {
    quillRef.current = quill
    setEditorContainer(quill.container as HTMLDivElement)
    if (!docId) return

    // Disable editing until we receive the initial document state
    quill.disable()

    const socket = getSocket()
    const ydoc = new Y.Doc()
    ydocRef.current = ydoc

    // 1. Bind Yjs ↔ Quill (sets up observers in both directions)
    const unbind = bindYjsToQuill(ydoc, quill)

    // 2. When server sends the full current Y.Doc state, apply it
    socket.on('load-document', (state: ArrayBuffer | Uint8Array) => {
      const update = state instanceof Uint8Array ? state : new Uint8Array(state)
      Y.applyUpdate(ydoc, update, 'server') // origin='server' → skips re-broadcast
      quill.enable()
      setTimeout(updateVisualCursors, 100)
    })

    // 3. When another user's update arrives, apply it to our Y.Doc
    //    The Yjs observer will automatically update Quill
    socket.on('yjs-update', (update: ArrayBuffer | Uint8Array) => {
      const u = update instanceof Uint8Array ? update : new Uint8Array(update)
      Y.applyUpdate(ydoc, u, 'server')
    })

    // 4. When our Y.Doc changes (from local typing), send update to server
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'server') return // don't re-broadcast remote updates
      socket.emit('yjs-update', docId, update)
    })

    // ── Listeners for Collaboration & Cursors ────────────────────────────────
    socket.on('existing-users', (users: Record<string, { name: string; color: string }>) => {
      const initialCollabs: Record<string, Collaborator> = {}
      Object.entries(users).forEach(([id, user]) => {
        initialCollabs[id] = {
          socketId: id,
          name: user.name,
          color: user.color,
          range: null,
        }
      })
      updateCollaborators(initialCollabs)
      setTimeout(updateVisualCursors, 100)
    })

    socket.on('user-joined', (user: { socketId: string; name: string; color: string }) => {
      updateCollaborators((prev) => ({
        ...prev,
        [user.socketId]: {
          socketId: user.socketId,
          name: user.name,
          color: user.color,
          range: null,
        },
      }))
      setTimeout(updateVisualCursors, 100)
    })

    socket.on('user-left', (socketId: string) => {
      updateCollaborators((prev) => {
        const next = { ...prev }
        delete next[socketId]
        return next
      })
      setTimeout(updateVisualCursors, 100)
    })

    socket.on('user-updated', (user: { socketId: string; name: string; color: string }) => {
      updateCollaborators((prev) => {
        if (!prev[user.socketId]) return prev
        return {
          ...prev,
          [user.socketId]: {
            ...prev[user.socketId],
            name: user.name,
            color: user.color,
          },
        }
      })
      setTimeout(updateVisualCursors, 100)
    })

    socket.on('cursor-move', (data: { socketId: string; name: string; color: string; range: { index: number; length: number } | null }) => {
      updateCollaborators((prev) => ({
        ...prev,
        [data.socketId]: {
          socketId: data.socketId,
          name: data.name,
          color: data.color,
          range: data.range,
        },
      }))
      setTimeout(updateVisualCursors, 50)
    })

    // ── Quill event listeners ────────────────────────────────────────────────
    const onSelectionChange = (range: any) => {
      socket.emit('cursor-move', docId, range)
    }
    quill.on('selection-change', onSelectionChange)

    const onTextChange = () => {
      updateVisualCursors()
    }
    quill.on('text-change', onTextChange)

    // ── Scroll listener on .ql-editor ────────────────────────────────────────
    const scrollContainer = quill.root
    const onScroll = () => {
      updateVisualCursors()
    }
    scrollContainer.addEventListener('scroll', onScroll)

    // 5. Join the room → server will reply with 'load-document'
    socket.emit('join-document', docId, localUserRef.current)

    return () => {
      unbind()
      quill.off('selection-change', onSelectionChange)
      quill.off('text-change', onTextChange)
      scrollContainer.removeEventListener('scroll', onScroll)
      socket.off('load-document')
      socket.off('yjs-update')
      socket.off('existing-users')
      socket.off('user-joined')
      socket.off('user-left')
      socket.off('user-updated')
      socket.off('cursor-move')
      ydoc.destroy()
      setEditorContainer(null)
    }
  }, [docId, updateCollaborators, updateVisualCursors])

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const selectedDateStr = selectedVersion
    ? new Date(selectedVersion.createdAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : ""

  return (
    <div className="min-h-screen flex flex-col h-screen overflow-hidden" style={{ background: '#f0f2f7' }}>

      {/* ── Top Bar (Version History or Live) ────────────────────────────────── */}
      {versionHistoryMode ? (
        <header className="flex items-center justify-between px-6 py-3.5 border-b shrink-0"
          style={{ background: '#ffffff', borderColor: 'rgba(0,0,0,0.08)' }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setVersionHistoryMode(false); setSelectedVersion(null); }}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer hover:bg-gray-100"
              style={{ color: '#6b7280', background: 'rgba(0,0,0,0.04)' }}
            >
              ← Close Preview
            </button>
            <span className="text-sm font-semibold text-gray-800" style={{ fontFamily: 'Outfit, sans-serif' }}>
              Version History
            </span>
            {selectedVersion && (
              <span className="text-xs px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(79,110,247,0.10)', color: '#4f6ef7' }}>
                Previewing: {selectedVersion.name} ({selectedDateStr})
              </span>
            )}
          </div>

          <div>
            <button
              disabled={!selectedVersion}
              onClick={handleRestoreVersion}
              className="text-xs px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: 'white',
                boxShadow: !selectedVersion ? 'none' : '0 0 16px rgba(16,185,129,0.3)',
              }}
            >
              Restore this version
            </button>
          </div>
        </header>
      ) : (
        <header className="flex items-center justify-between px-6 py-3 border-b shrink-0"
          style={{ background: '#ffffff', borderColor: 'rgba(0,0,0,0.08)' }}>

          {/* Left */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-sm px-3 py-1.5 rounded-lg transition-colors duration-150 cursor-pointer hover:bg-gray-100"
              style={{ color: '#6b7280', background: 'rgba(0,0,0,0.04)' }}>
              ← Home
            </button>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm text-white"
                style={{ background: 'linear-gradient(135deg, #4f6ef7, #7c3aed)' }}>
                ✦
              </div>
              <span className="font-semibold text-sm text-gray-800" style={{ fontFamily: 'Outfit, sans-serif' }}>
                {title}
              </span>
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">

            {/* Live indicator */}
            <div className="flex items-center gap-1.5 text-xs"
              style={{ color: connected ? '#34d399' : '#ef4444' }}>
              <div className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  background: connected ? '#34d399' : '#ef4444',
                  boxShadow: connected ? '0 0 8px #34d399' : 'none',
                  animationPlayState: connected ? 'running' : 'paused',
                }} />
              {connected ? 'Live' : 'Offline'}
            </div>

            {/* Collaborator Avatars */}
            <div className="flex items-center -space-x-1.5 mr-2">
              {Object.entries(collaborators).map(([socketId, col]) => (
                <div
                  key={socketId}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 select-none relative group"
                  style={{
                    backgroundColor: col.color,
                    borderColor: '#ffffff',
                    color: '#ffffff',
                  }}
                >
                  {getInitials(col.name)}
                  <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-white border border-gray-200 text-[10px] text-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xl z-50">
                    {col.name}
                  </div>
                </div>
              ))}

              {/* Local User Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 select-none relative group"
                style={{
                  backgroundColor: localUser.color,
                  borderColor: '#ffffff',
                  color: '#ffffff',
                }}
              >
                {getInitials(localUser.name)}
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-white border border-gray-200 text-[10px] text-gray-700 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-xl z-50">
                  {localUser.name} (You)
                </div>
              </div>
            </div>

            {/* Nickname input */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs"
              style={{ background: '#f3f4f6', borderColor: 'rgba(0,0,0,0.08)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: localUser.color }} />
              <input
                type="text"
                value={localUser.name}
                onChange={(e) => handleUpdateName(e.target.value)}
                className="bg-transparent border-none outline-none p-0 text-[11px] font-medium text-gray-700 focus:ring-0 focus:outline-none w-24"
                placeholder="Your name..."
              />
            </div>

            {/* Version History Button */}
            <button
              onClick={() => { setVersionHistoryMode(true); fetchVersions(); }}
              className="text-xs px-3 py-1.5 rounded-lg transition-all duration-200 cursor-pointer flex items-center gap-1 hover:bg-gray-100"
              style={{
                color: '#6b7280',
                background: 'rgba(0,0,0,0.04)',
                border: '1px solid rgba(0,0,0,0.08)',
              }}
            >
              🕒 History
            </button>

            {/* CRDT badge */}
            <div className="text-xs px-2 py-1 rounded-lg hidden lg:block"
              style={{ background: 'rgba(16,185,129,0.08)', color: '#059669', border: '1px solid rgba(16,185,129,0.2)' }}>
              ⚡ Yjs CRDT
            </div>

            {/* Doc ID */}
            <span className="text-xs font-mono px-2 py-1 rounded hidden md:block"
              style={{ background: '#f3f4f6', color: '#9ca3af' }}>
              {docId?.slice(0, 8)}…
            </span>

            {/* Share */}
            <button
              onClick={copyLink}
              className="text-sm px-4 py-1.5 rounded-lg font-medium transition-all duration-200 cursor-pointer"
              style={{
                background: copied ? 'rgba(16,185,129,0.12)' : 'linear-gradient(135deg, #4f6ef7, #7c3aed)',
                color: copied ? '#059669' : 'white',
                boxShadow: copied ? 'none' : '0 4px 12px rgba(79,110,247,0.3)',
              }}>
              {copied ? '✓ Copied!' : 'Share Link'}
            </button>
          </div>
        </header>
      )}

      {/* ── Main Workspace ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Live Editor (hidden when version history is active) */}
        <main 
          className={`flex-1 overflow-y-auto py-10 px-4 flex-col items-center ${versionHistoryMode ? 'hidden' : 'flex'}`}
          style={{ background: '#f0f2f7' }}
        >
          <div className="w-full max-w-3xl">
            <EditorComponent onReady={handleEditorReady} />
          </div>
        </main>

        {/* Version History Preview Editor */}
        {versionHistoryMode && (
          <main className="flex-1 overflow-y-auto py-10 px-4 flex flex-col items-center" style={{ background: '#f0f2f7' }}>
            <div className="w-full max-w-3xl">
              {selectedVersion ? (
                <PreviewEditor content={selectedVersion.content!} />
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-2 h-full">
                  <div className="text-4xl animate-bounce">🕒</div>
                  <div className="text-sm font-medium">Select a revision on the right to preview.</div>
                </div>
              )}
            </div>
          </main>
        )}

        {/* Version History Sidebar */}
        {versionHistoryMode && (
          <aside className="w-80 border-l flex flex-col shrink-0" style={{ background: '#ffffff', borderColor: 'rgba(0,0,0,0.08)' }}>
            <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
              <h3 className="font-semibold text-sm text-gray-800" style={{ fontFamily: 'Outfit, sans-serif' }}>Revisions</h3>
              
              {!showNameDialog ? (
                <button
                  onClick={() => setShowNameDialog(true)}
                  className="w-full py-2 text-xs font-semibold text-white rounded-lg transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                  style={{
                    background: 'linear-gradient(135deg, #4f6ef7, #7c3aed)',
                    boxShadow: '0 4px 12px rgba(79,110,247,0.25)',
                  }}
                >
                  <span>+ Save Current Version</span>
                </button>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); handleSaveVersion(newVersionName); }} className="flex flex-col gap-2">
                  <input
                    type="text"
                    placeholder="Version name (e.g. Draft 1)"
                    value={newVersionName}
                    onChange={(e) => setNewVersionName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                    style={{ background: '#f3f4f6', border: '1px solid rgba(0,0,0,0.10)', color: '#111827' }}
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => { setShowNameDialog(false); setNewVersionName(""); }}
                      className="px-2.5 py-1.5 text-[10px] rounded hover:bg-gray-100 transition-colors"
                      style={{ color: '#6b7280' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingVersion}
                      className="px-2.5 py-1.5 text-[10px] font-semibold text-white rounded bg-indigo-600 hover:bg-indigo-500 transition-colors disabled:opacity-50"
                    >
                      {savingVersion ? "Saving..." : "Save"}
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* List of saved revisions */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {versionsList.length === 0 ? (
                <div className="text-center py-8 text-xs" style={{ color: '#9ca3af' }}>
                  No saved revisions yet.
                </div>
              ) : (
                versionsList.map((ver) => {
                  const isSelected = selectedVersion?.id === ver.id
                  const dateStr = new Date(ver.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                  return (
                    <button
                      key={ver.id}
                      onClick={() => handleSelectVersion(ver.id)}
                      className="w-full text-left p-3 rounded-xl transition-all duration-200 border cursor-pointer group"
                      style={{
                        background: isSelected ? 'rgba(79,110,247,0.08)' : '#f9fafb',
                        borderColor: isSelected ? 'rgba(79,110,247,0.35)' : 'rgba(0,0,0,0.06)',
                      }}
                    >
                      <div className="font-semibold text-xs transition-colors" style={{ color: isSelected ? '#4f6ef7' : '#111827' }}>
                        {ver.name}
                      </div>
                      <div className="text-[10px] mt-1" style={{ color: '#9ca3af' }}>
                        {dateStr}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Remote Cursors Overlay ────────────────────────────────────────────── */}
      {editorContainer && createPortal(
        <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }}>
          {Object.entries(visualCursors).map(([socketId, cur]) => {
            if (!cur.visible) return null
            const isNearTop = cur.top < 24
            return (
              <div
                key={socketId}
                className="absolute w-[2px] transition-all duration-100 ease-out pointer-events-none"
                style={{
                  left: cur.left,
                  top: cur.top,
                  height: cur.height,
                  backgroundColor: cur.color,
                }}
              >
                {/* Caret Flag */}
                <div
                  className="absolute left-0 px-1.5 py-0.5 rounded text-[10px] font-bold text-white whitespace-nowrap shadow-md select-none transition-opacity duration-300 pointer-events-none"
                  style={{
                    backgroundColor: cur.color,
                    transform: 'translateX(-2px)',
                    ...(isNearTop 
                      ? { top: '100%', marginTop: '4px' } 
                      : { bottom: '100%', marginBottom: '4px' })
                  }}
                >
                  {cur.name}
                </div>
              </div>
            )
          })}
        </div>,
        editorContainer
      )}
    </div>
  )
}
