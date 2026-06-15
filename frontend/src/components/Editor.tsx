import { useEffect, useRef } from 'react'
import Quill from 'quill'
import 'quill/dist/quill.snow.css'
import './Editor.css'

interface EditorProps {
  // Will receive Yjs doc + socket in later steps
  onReady?: (quill: Quill) => void
}

const TOOLBAR_OPTIONS = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ indent: '-1' }, { indent: '+1' }],
  [{ align: [] }],
  ['blockquote', 'code-block'],
  ['link'],
  ['clean'],
]

export default function Editor({ onReady }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<Quill | null>(null)

  useEffect(() => {
    if (!containerRef.current || quillRef.current) return

    // Clear any leftover children from previous mounts to avoid duplication
    containerRef.current.innerHTML = ''

    // Mount Quill onto the div
    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules: { toolbar: TOOLBAR_OPTIONS },
      placeholder: 'Start writing… changes sync in real time.',
    })

    quillRef.current = quill

    // Give parent access to the raw Quill instance (needed for Yjs in Step 8)
    onReady?.(quill)

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
  }, [onReady])

  return (
    <div className="quill-wrapper">
      <div ref={containerRef} />
    </div>
  )
}
