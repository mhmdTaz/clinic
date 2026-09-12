import nodemailer, { type Transporter } from 'nodemailer'
import { env, processSingleton } from '@clinic/config'

export interface OutgoingMail {
  to: string
  subject: string
  text: string
  html: string
}

// One SMTP transport per process, not one per bundle copy of this module.
const shared = processSingleton('identity:mail-transport', () => ({
  transporter: null as Transporter | null,
}))

/**
 * SMTP through a single adapter (section 3). Locally this is Mailpit on port 1025, and
 * every message is visible at http://localhost:8025. A provider such as SES or Resend
 * is a different SMTP_URL, not a code change.
 *
 * It lives at the root rather than inside a module because two modules send mail — identity
 * sends invitations, notifications sends everything else — and a transport one of them owned
 * would make the other import through it. Same reasoning as pdf-text.ts.
 */
export const mailer = {
  async send(mail: OutgoingMail): Promise<void> {
    shared.transporter ??= nodemailer.createTransport(env().SMTP_URL)
    await shared.transporter.sendMail({ from: env().MAIL_FROM, ...mail })
  },
}
