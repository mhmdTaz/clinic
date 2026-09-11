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
 */
export const mailer = {
  async send(mail: OutgoingMail): Promise<void> {
    shared.transporter ??= nodemailer.createTransport(env().SMTP_URL)
    await shared.transporter.sendMail({ from: env().MAIL_FROM, ...mail })
  },
}
