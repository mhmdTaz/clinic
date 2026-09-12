'use client'

import { useId, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FILE_CATEGORIES, FILE_MIME_TYPES, MAX_FILE_BYTES } from '@clinic/config'
import type { FileCategory, PresignedUpload, StoredFile } from '@clinic/contracts'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  Spinner,
} from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage } from '@/lib/i18n/use-error-message'
import { useRouter } from '@/lib/navigation/use-router'

/**
 * Uploading a document (S14, section 12.1), in the three steps the architecture describes:
 * ask for somewhere to put it, PUT the bytes straight to storage, then tell the server it
 * landed. The bytes never touch the application, so a 20 MB scan does not hold a request slot
 * for the length of the transfer.
 *
 * The middle step is a bare `fetch` rather than `apiFetch`: it goes to object storage, not to
 * this application, and must not carry our cookies with it.
 */
export function FileUploadDialog({
  ownerType,
  ownerId,
  label,
  defaultCategory = 'OTHER',
  canShareWithPatient = true,
}: {
  ownerType: 'PATIENT' | 'ENCOUNTER'
  ownerId: string
  label: string
  defaultCategory?: FileCategory
  canShareWithPatient?: boolean
}) {
  const t = useTranslations('clinical.files')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const errorMessage = useErrorMessage()
  const fieldId = useId()
  const input = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<FileCategory>(defaultCategory)
  const [description, setDescription] = useState('')
  const [shared, setShared] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setFile(null)
    setCategory(defaultCategory)
    setDescription('')
    setShared(false)
    setError(null)
    if (input.current) input.current.value = ''
  }

  /** Refused here as well as on the server, so the person finds out before the upload starts. */
  function choose(chosen: File | null) {
    setError(null)
    if (!chosen) {
      setFile(null)
      return
    }
    if (!FILE_MIME_TYPES.includes(chosen.type as (typeof FILE_MIME_TYPES)[number])) {
      setFile(null)
      setError(t('unsupportedType'))
      return
    }
    if (chosen.size > MAX_FILE_BYTES) {
      setFile(null)
      setError(t('tooLarge', { megabytes: Math.floor(MAX_FILE_BYTES / (1024 * 1024)) }))
      return
    }
    setFile(chosen)
  }

  async function upload() {
    if (!file) return
    setPending(true)
    setError(null)
    try {
      const presigned = await apiFetch<PresignedUpload>('/api/v1/files/presign-upload', {
        method: 'POST',
        body: {
          ownerType,
          ownerId,
          category,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          isPatientVisible: shared,
          description: description.trim() || null,
        },
      })

      const stored = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: presigned.headers,
        body: file,
        // Storage is another origin: our session must not ride along with the bytes.
        credentials: 'omit',
      })
      if (!stored.ok) throw new ApiError(stored.status, 'UPLOAD_FAILED', '')

      await apiFetch<StoredFile>(`/api/v1/files/${presigned.fileId}/confirm`, {
        method: 'POST',
        body: { checksumSha256: null },
      })

      setOpen(false)
      reset()
      router.refresh()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('uploadTitle')}</DialogTitle>
          <DialogDescription>{t('uploadDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-file`}>{t('file')}</Label>
            <Input
              id={`${fieldId}-file`}
              ref={input}
              type="file"
              accept={FILE_MIME_TYPES.join(',')}
              onChange={(event) => choose(event.target.files?.[0] ?? null)}
            />
            <p className="text-muted-foreground text-xs">{t('accepted')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-category`}>{t('category')}</Label>
            <Select
              id={`${fieldId}-category`}
              value={category}
              onChange={(event) => setCategory(event.target.value as FileCategory)}
            >
              {FILE_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {t(`categories.${option}`)}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-description`}>
              {t('description')}{' '}
              <span className="text-muted-foreground">({tCommon('optional')})</span>
            </Label>
            <Input
              id={`${fieldId}-description`}
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {canShareWithPatient ? (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t('shareWithPatient')}</span>
                <span className="text-muted-foreground block text-xs">{t('shareHint')}</span>
              </span>
            </label>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button disabled={pending || !file} onClick={() => void upload()}>
            {pending ? <Spinner /> : null}
            {pending ? t('uploading') : t('upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
