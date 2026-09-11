'use client'

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { ZodTypeAny } from 'zod'
import { issueCode, issuePath } from '@clinic/contracts'
import { Alert, Button, Checkbox, Input, Select, Spinner, Textarea, cn } from '@clinic/ui'
import { ApiError, apiFetch } from '@/lib/api/client'
import { useErrorMessage, useValidationMessage } from '@/lib/i18n/use-error-message'
import { buildBody, fieldForPath, initialValueOf, type FieldKind } from './auto-form-values'
import { Field, describedBy } from './field'

export interface AutoFormOption {
  value: string
  label: string
  disabled?: boolean
}

export interface CustomControl {
  id: string
  value: unknown
  onChange: (value: unknown) => void
  /** Messages keyed by the path below this field: "0.phone" for "emergencyContacts.0.phone". */
  errors: Readonly<Record<string, string[]>>
  disabled: boolean
}

export interface AutoFormField {
  /** A dotted path into the request body: "contact.phone". */
  name: string
  label: string
  kind: FieldKind
  required?: boolean
  hint?: string
  placeholder?: string
  options?: readonly AutoFormOption[]
  span?: 1 | 2
  autoComplete?: string
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email'
  maxLength?: number
  min?: string
  max?: string
  suffix?: string
  disabled?: boolean
  render?: (control: CustomControl) => ReactNode
}

export interface AutoFormSection {
  id: string
  title?: string
  description?: string
  fields: readonly AutoFormField[]
}

export interface AutoFormProps {
  /** The request contract — the same schema the route handler parses with. */
  schema: ZodTypeAny
  sections: readonly AutoFormSection[]
  initialValues?: Readonly<Record<string, unknown>>
  action: string
  method: 'POST' | 'PUT' | 'PATCH'
  submitLabel: string
  successMessage?: string
  /** Runs with the validated body. Return the body to send, or null to stop without an error. */
  beforeSubmit?: (body: unknown) => Promise<unknown | null>
  onSuccess?: (data: unknown) => void
  /** Server error fields that belong to a differently named form field. */
  fieldAliases?: Readonly<Record<string, string>>
  readOnly?: boolean
  notice?: ReactNode
  secondaryActions?: ReactNode
}

type Errors = Record<string, string[]>

/**
 * A form rendered from a field list and validated with the request contract (section 14.3).
 *
 * The contract validates; the field list lays out. Deriving the layout from the Zod schema as well
 * breaks on the first refinement, preprocessing step or nested array, and a form's order and
 * wording are decisions, not something a schema knows. What the schema does guarantee is that the
 * browser and the server accept exactly the same input.
 */
export function AutoForm({
  schema,
  sections,
  initialValues,
  action,
  method,
  submitLabel,
  successMessage,
  beforeSubmit,
  onSuccess,
  fieldAliases,
  readOnly = false,
  notice,
  secondaryActions,
}: AutoFormProps) {
  const t = useTranslations('common')
  const validationMessage = useValidationMessage()
  const errorMessage = useErrorMessage()
  const formId = useId()

  const fields = useMemo(() => sections.flatMap((section) => section.fields), [sections])
  const fieldNames = useMemo(() => fields.map((field) => field.name), [fields])
  const initial = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [field.name, initialValueOf(field.kind, initialValues, field.name)]),
      ),
    [fields, initialValues],
  )
  const initialKey = JSON.stringify(initial)

  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [baseline, setBaseline] = useState(initialKey)
  const [errors, setErrors] = useState<Errors>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const dirty = JSON.stringify(values) !== baseline

  // Fresh data from the server (after router.refresh) replaces the values — unless the person is
  // part-way through editing, whose work is never overwritten.
  const latest = useRef({ dirty, initial })
  latest.current = { dirty, initial }
  useEffect(() => {
    if (!latest.current.dirty) {
      setValues(latest.current.initial)
      setBaseline(initialKey)
    }
  }, [initialKey])

  // Leaving with unsaved changes asks first. In-app links are not intercepted: the App Router
  // offers no reliable hook for that, so the "Unsaved changes" marker beside Save does the work.
  useEffect(() => {
    if (!dirty || readOnly) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, readOnly])

  const fieldId = (name: string) => `${formId}-${name.replaceAll('.', '-')}`

  function update(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }))
    setSuccess(null)
    setErrors((current) => {
      const next = { ...current }
      for (const path of Object.keys(next)) {
        if (path === name || path.startsWith(`${name}.`)) delete next[path]
      }
      return next
    })
  }

  function messagesFor(name: string): string[] {
    return [
      ...new Set(
        Object.entries(errors)
          .filter(([path]) => path === name || path.startsWith(`${name}.`))
          .flatMap(([, messages]) => messages),
      ),
    ]
  }

  function nestedErrors(name: string): Errors {
    return Object.fromEntries(
      Object.entries(errors)
        .filter(([path]) => path.startsWith(`${name}.`))
        .map(([path, messages]) => [path.slice(name.length + 1), messages]),
    )
  }

  /** Places each issue beside its field; what has no field becomes the form-level message. */
  function place(details: ReadonlyArray<{ field: string; issue: string }>) {
    const placed: Errors = {}
    let unplaced = false
    for (const detail of details) {
      const path = fieldAliases?.[detail.field] ?? detail.field
      if (!fieldForPath(path, fieldNames)) {
        unplaced = true
        continue
      }
      ;(placed[path] ??= []).push(validationMessage(detail.issue))
    }
    setErrors(placed)
    const first = fields.find((field) =>
      Object.keys(placed).some((path) => path === field.name || path.startsWith(`${field.name}.`)),
    )
    if (first) requestAnimationFrame(() => document.getElementById(fieldId(first.name))?.focus())
    return { unplaced, placedAny: Object.keys(placed).length > 0 }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readOnly || pending) return
    setGeneral(null)
    setSuccess(null)

    const parsed = schema.safeParse(buildBody(fields, values))
    if (!parsed.success) {
      const { unplaced } = place(
        parsed.error.issues.map((issue) => ({ field: issuePath(issue), issue: issueCode(issue) })),
      )
      setGeneral(errorMessage(new ApiError(400, 'VALIDATION_FAILED', '')))
      if (unplaced)
        console.warn('[form] a validation issue has no field on this form', parsed.error.issues)
      return
    }

    setPending(true)
    try {
      const body = beforeSubmit ? await beforeSubmit(parsed.data) : parsed.data
      if (body === null) return
      const data = await apiFetch<unknown>(action, { method, body })
      setErrors({})
      setBaseline(JSON.stringify(values))
      if (successMessage) setSuccess(successMessage)
      onSuccess?.(data)
    } catch (caught) {
      if (caught instanceof ApiError && caught.details.length > 0) {
        const { unplaced, placedAny } = place(caught.details)
        setGeneral(unplaced || !placedAny ? errorMessage(caught) : null)
      } else {
        setErrors({})
        setGeneral(errorMessage(caught))
      }
    } finally {
      setPending(false)
    }
  }

  function renderField(field: AutoFormField) {
    const id = fieldId(field.name)
    const messages = messagesFor(field.name)
    const invalid = messages.length > 0
    const disabled = readOnly || field.disabled === true
    const span = field.span === 2 ? 'sm:col-span-2' : undefined
    const value = values[field.name]
    const aria = {
      'aria-invalid': invalid || undefined,
      'aria-required': field.required || undefined,
      'aria-describedby': describedBy(id, Boolean(field.hint), invalid),
    }
    const errorList = invalid ? (
      <ul id={`${id}-error`} className="text-danger flex flex-col gap-0.5 text-xs font-medium">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    ) : null
    const hint =
      field.hint && !invalid ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {field.hint}
        </p>
      ) : null

    switch (field.kind) {
      case 'checkbox':
        return (
          <div key={field.name} className={cn('flex flex-col gap-1', span)}>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <Checkbox
                id={id}
                checked={value === true}
                disabled={disabled}
                onChange={(event) => update(field.name, event.target.checked)}
                {...aria}
              />
              {field.label}
            </label>
            {hint}
            {errorList}
          </div>
        )

      case 'checkboxes': {
        const selected = Array.isArray(value) ? (value as string[]) : []
        return (
          <fieldset
            key={field.name}
            id={id}
            tabIndex={-1}
            aria-describedby={aria['aria-describedby']}
            className={cn('flex flex-col gap-2', span)}
          >
            <legend className="mb-1 text-sm font-medium">{field.label}</legend>
            {hint}
            <div className="grid gap-x-4 sm:grid-cols-2">
              {(field.options ?? []).map((option) => (
                <label key={option.value} className="flex min-h-11 items-center gap-3 text-sm">
                  <Checkbox
                    checked={selected.includes(option.value)}
                    disabled={disabled || option.disabled}
                    onChange={(event) =>
                      update(
                        field.name,
                        event.target.checked
                          ? [...selected, option.value]
                          : selected.filter((item) => item !== option.value),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
            {errorList}
          </fieldset>
        )
      }

      case 'custom':
        return (
          <div key={field.name} className={span}>
            {field.render?.({
              id,
              value,
              onChange: (next) => update(field.name, next),
              errors: nestedErrors(field.name),
              disabled,
            })}
            {nestedErrors(field.name)[''] ? null : errors[field.name] ? errorList : null}
          </div>
        )

      default: {
        const text = typeof value === 'string' ? value : ''
        const control =
          field.kind === 'textarea' ? (
            <Textarea
              id={id}
              value={text}
              maxLength={field.maxLength}
              placeholder={field.placeholder}
              disabled={disabled}
              onChange={(event) => update(field.name, event.target.value)}
              {...aria}
            />
          ) : field.kind === 'select' ? (
            <Select
              id={id}
              value={text}
              disabled={disabled}
              onChange={(event) => update(field.name, event.target.value)}
              {...aria}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id={id}
              type={
                field.kind === 'email' || field.kind === 'tel' || field.kind === 'date'
                  ? field.kind
                  : 'text'
              }
              inputMode={
                field.inputMode ??
                (field.kind === 'money'
                  ? 'decimal'
                  : field.kind === 'number'
                    ? 'numeric'
                    : undefined)
              }
              value={text}
              maxLength={field.maxLength}
              min={field.min}
              max={field.max}
              placeholder={field.placeholder}
              autoComplete={field.autoComplete}
              disabled={disabled}
              onChange={(event) => update(field.name, event.target.value)}
              {...aria}
            />
          )

        return (
          <div key={field.name} className={span}>
            <Field id={id} label={field.label} hint={field.hint} errors={messages}>
              {field.suffix ? (
                <div className="flex items-center gap-2">
                  {control}
                  <span className="text-muted-foreground shrink-0 text-sm">{field.suffix}</span>
                </div>
              ) : (
                control
              )}
            </Field>
          </div>
        )
      }
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {notice}
      {success ? <Alert tone="success">{success}</Alert> : null}
      {general ? <Alert tone="danger">{general}</Alert> : null}

      {sections.map((section) => (
        <fieldset key={section.id} className="flex min-w-0 flex-col gap-4">
          {section.title ? (
            <legend className="mb-3 flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{section.title}</span>
              {section.description ? (
                <span className="text-muted-foreground text-xs font-normal">
                  {section.description}
                </span>
              ) : null}
            </legend>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">{section.fields.map(renderField)}</div>
        </fieldset>
      ))}

      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? t('saving') : submitLabel}
          </Button>
          {secondaryActions}
          {dirty && !pending ? (
            <span className="text-muted-foreground text-xs">{t('unsaved')}</span>
          ) : null}
        </div>
      )}
    </form>
  )
}
