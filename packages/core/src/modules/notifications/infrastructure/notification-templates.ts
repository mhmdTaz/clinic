import type { OutgoingMail } from '../../../mailer'

/**
 * The email a notification goes out as (section 8.12).
 *
 * One layout for every notification type rather than a template per type: the title and body are
 * already written by whoever raised it, and a second place to phrase things is a second place for
 * them to drift. Admin-editable templates are a Phase 8 item, alongside the i18n pass — this is
 * English, escaped, and deliberately plain.
 *
 * Everything interpolated is escaped. A ticket subject is text somebody typed, and an email body
 * is not a place to let markup through.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Paragraphs, so a body written with blank lines survives into the email looking like one. */
function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map(
      (chunk) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6">${escapeHtml(chunk).replaceAll('\n', '<br>')}</p>`,
    )
    .join('')
}

export interface NotificationMail {
  to: string
  firstName: string
  clinicName: string
  title: string
  body: string
  action: { href: string; label: string } | null
}

export function notificationTemplate(input: NotificationMail): OutgoingMail {
  const greeting = input.firstName ? `Hello ${input.firstName},` : 'Hello,'

  const button = input.action
    ? `<p style="margin:28px 0"><a href="${escapeHtml(input.action.href)}" style="display:inline-block;background:#2f5bd3;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(input.action.label)}</a></p>`
    : ''

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d2433">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e6eb;border-radius:12px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7385">${escapeHtml(input.clinicName)}</p>
            <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(input.title)}</h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.6">${escapeHtml(greeting)}</p>
            ${paragraphs(input.body)}
            ${button}
            <p style="margin:28px 0 0;font-size:13px;color:#6b7385">You can change which of these you receive in your account settings.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`

  const text = [
    input.clinicName,
    '',
    input.title,
    '',
    greeting,
    '',
    input.body,
    ...(input.action ? ['', `${input.action.label}: ${input.action.href}`] : []),
    '',
    'You can change which of these you receive in your account settings.',
  ].join('\n')

  return { to: input.to, subject: `${input.title} · ${input.clinicName}`, text, html }
}
