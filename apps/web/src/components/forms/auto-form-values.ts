/**
 * The value handling behind AutoForm, kept pure so it is unit-tested without a DOM. A form holds
 * one flat value per field name; a field name is a dotted path into the request body.
 */
export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'date'
  | 'number'
  | 'money'
  | 'select'
  | 'checkbox'
  | 'checkboxes'
  | 'custom'

export function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[key]
  }, source)
}

export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) {
    const child = node[key]
    if (child === null || typeof child !== 'object' || Array.isArray(child)) node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  node[keys[keys.length - 1] as string] = value
}

/** What a control starts with: text controls hold strings, never null or undefined. */
export function initialValueOf(kind: FieldKind, source: unknown, name: string): unknown {
  const raw = getPath(source, name)
  switch (kind) {
    case 'checkbox':
      return raw === true
    case 'checkboxes':
      return Array.isArray(raw) ? raw.map(String) : []
    case 'custom':
      return raw
    default:
      return raw === null || raw === undefined ? '' : String(raw)
  }
}

/**
 * The request body. Text goes as typed — the contract turns an emptied field into null and a
 * typed number into a number — so the browser and the server interpret it identically.
 */
export function buildBody(
  fields: ReadonlyArray<{ name: string }>,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const field of fields) setPath(body, field.name, values[field.name])
  return body
}

/**
 * The form field an error path belongs to: the field of that name, or the field whose value holds
 * the path ("roleIds.2" belongs to "roleIds"). A server field the form names differently is
 * translated through `aliases` first.
 */
export function fieldForPath(
  path: string,
  fieldNames: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): string | null {
  const mapped = aliases[path] ?? path
  if (fieldNames.includes(mapped)) return mapped
  const owners = fieldNames.filter((name) => mapped.startsWith(`${name}.`))
  return owners.sort((a, b) => b.length - a.length)[0] ?? null
}
