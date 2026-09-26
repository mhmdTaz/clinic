'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { DentalTreatment } from '@clinic/contracts'
import { Button } from '@clinic/ui'
import { parseVoiceCharting, type VoiceDraft } from '@/lib/dental/voice'

/** The part of the Web Speech API used here; browsers still ship it under a vendor prefix. */
interface Recognition {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => Recognition

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * Charting by voice (Phase 13, ADR-0037), shown only when the clinic has turned it on. One
 * sentence per press — "sixteen MOD composite done" — becomes a draft in the tooth's form, to be
 * read and saved by a person; nothing is written from here. English only, for now.
 *
 * The browser does the listening. In Chrome that means Google's speech service hears it, which is
 * why the clinic has to turn it on knowingly, and why the button says it is listening.
 */
export function VoiceButton({
  treatments,
  onDraft,
}: {
  treatments: readonly DentalTreatment[]
  onDraft: (draft: VoiceDraft) => void
}) {
  const t = useTranslations('dental.voice')
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const active = useRef<Recognition | null>(null)
  const onDraftRef = useRef(onDraft)
  onDraftRef.current = onDraft

  // Read after mount: the server has no window.
  useEffect(() => {
    setSupported(recognitionConstructor() !== null)
    return () => active.current?.abort()
  }, [])

  if (!supported) return null

  function start() {
    const Constructor = recognitionConstructor()
    if (!Constructor) return
    const recognition = new Constructor()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ''
      const parsed = parseVoiceCharting(transcript, treatments)
      if (parsed.ok) {
        setMessage(null)
        onDraftRef.current(parsed.draft)
      } else {
        setMessage(
          t(parsed.reason === 'NO_TOOTH' ? 'noTooth' : 'noTreatment', { heard: transcript }),
        )
      }
    }
    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are a silence and a second press, not failures worth a sentence.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMessage(t('blocked'))
      } else if (event.error === 'network') {
        setMessage(t('offline'))
      }
    }
    recognition.onend = () => {
      setListening(false)
      active.current = null
    }
    active.current = recognition
    setMessage(null)
    setListening(true)
    recognition.start()
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        size="sm"
        variant={listening ? 'danger' : 'outline'}
        aria-pressed={listening}
        onClick={() => (listening ? active.current?.stop() : start())}
        title={t('hint')}
      >
        {listening ? (
          <MicOff aria-hidden="true" className="size-4" />
        ) : (
          <Mic aria-hidden="true" className="size-4" />
        )}
        {listening ? t('listening') : t('speak')}
      </Button>
      {message ? (
        <p className="text-danger max-w-xs text-xs" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
