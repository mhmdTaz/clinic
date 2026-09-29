'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

export interface SignaturePadHandle {
  /** The drawing as a PNG, or null when nothing has been drawn. */
  toBlob(): Promise<Blob | null>
  clear(): void
}

/**
 * A box to sign in with a finger, a stylus or a mouse. The strokes are drawn at the screen's
 * pixel density so the stored signature is not blurred on a tablet, in dark ink on white whatever
 * the theme — it is a document, and will be printed.
 */
export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { label: string; onInk: (hasInk: boolean) => void; className?: string }
>(function SignaturePad({ label, onInk, className }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const inked = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const onInkRef = useRef(onInk)
  onInkRef.current = onInk

  const context = () => canvas.current?.getContext('2d') ?? null

  // Only refs are read, so one function serves every render.
  const paper = useCallback(() => {
    const element = canvas.current
    const ctx = element?.getContext('2d') ?? null
    if (!element || !ctx) return
    const ratio = window.devicePixelRatio || 1
    const { width, height } = element.getBoundingClientRect()
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111827'
    inked.current = false
    onInkRef.current(false)
  }, [])

  useEffect(() => {
    paper()
  }, [paper])

  useImperativeHandle(ref, () => ({
    clear: paper,
    toBlob: () =>
      new Promise((resolve) => {
        if (!inked.current || !canvas.current) return resolve(null)
        canvas.current.toBlob((blob) => resolve(blob), 'image/png')
      }),
  }))

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        last.current = point(event)
        const ctx = context()
        if (!ctx) return
        // A tap is a dot.
        ctx.beginPath()
        ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2)
        ctx.fillStyle = '#111827'
        ctx.fill()
      }}
      onPointerMove={(event) => {
        if (!last.current) return
        const ctx = context()
        if (!ctx) return
        const next = point(event)
        ctx.beginPath()
        ctx.moveTo(last.current.x, last.current.y)
        ctx.lineTo(next.x, next.y)
        ctx.stroke()
        last.current = next
        if (!inked.current) {
          inked.current = true
          onInkRef.current(true)
        }
      }}
      onPointerUp={() => {
        last.current = null
      }}
      onPointerCancel={() => {
        last.current = null
      }}
    />
  )
})
