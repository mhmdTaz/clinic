import type { OutgoingMail } from './mailer'

/**
 * Transactional emails. Names are escaped before they reach HTML: a first name is text a
 * person typed, and an email body is not a place to let markup through.
 *
 * English only for now. Emails move to the message catalogue with the full i18n pass
 * in Phase 8, alongside the notification templates admins can edit.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function layout(clinicName: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1d2433">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e6eb;border-radius:12px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7385">${escapeHtml(clinicName)}</p>
            ${body}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#2f5bd3;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:13px;color:#6b7385">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`
}

export function passwordResetEmail(input: {
  to: string
  firstName: string
  clinicName: string
  link: string
  expiresInMinutes: number
}): OutgoingMail {
  const subject = `Reset your ${input.clinicName} password`
  return {
    to: input.to,
    subject,
    text: [
      `Hello ${input.firstName},`,
      '',
      `Someone asked to reset the password for your ${input.clinicName} account.`,
      `Use this link within ${input.expiresInMinutes} minutes:`,
      input.link,
      '',
      'If this was not you, you can ignore this email — your password has not changed.',
    ].join('\n'),
    html: layout(
      input.clinicName,
      `<h1 style="margin:0 0 12px;font-size:20px">Reset your password</h1>
<p style="margin:0 0 8px;line-height:1.6">Hello ${escapeHtml(input.firstName)},</p>
<p style="margin:0;line-height:1.6">Someone asked to reset the password for your account. This link works once and expires in ${input.expiresInMinutes} minutes.</p>
${button(input.link, 'Choose a new password')}
<p style="margin:24px 0 0;font-size:13px;color:#6b7385">If this was not you, ignore this email. Your password has not changed.</p>`,
    ),
  }
}

export function invitationEmail(input: {
  to: string
  firstName: string
  clinicName: string
  link: string
  expiresInDays: number
}): OutgoingMail {
  const subject = `Activate your ${input.clinicName} account`
  return {
    to: input.to,
    subject,
    text: [
      `Hello ${input.firstName},`,
      '',
      `${input.clinicName} has created an account for you.`,
      `Choose a password to activate it within ${input.expiresInDays} days:`,
      input.link,
    ].join('\n'),
    html: layout(
      input.clinicName,
      `<h1 style="margin:0 0 12px;font-size:20px">Activate your account</h1>
<p style="margin:0 0 8px;line-height:1.6">Hello ${escapeHtml(input.firstName)},</p>
<p style="margin:0;line-height:1.6">${escapeHtml(input.clinicName)} has created an account for you. Choose a password to activate it. This link expires in ${input.expiresInDays} days.</p>
${button(input.link, 'Activate my account')}`,
    ),
  }
}
