import { expect, type Browser, type Locator, type Page } from '@playwright/test'
import { E2E } from '../e2e.env'

/** A documentation-range address (RFC 5737), different per call so per-IP limits never collide. */
export function randomAddress(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1
  return `198.51.${octet()}.${octet()}`
}

/**
 * A second, independent browser — another person at another desk. Contexts made by hand do not
 * inherit the project's settings, so the base URL and the client address are set here.
 */
export async function newPersonPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: E2E.appUrl,
    extraHTTPHeaders: { 'x-real-ip': randomAddress() },
  })
  return context.newPage()
}

export const SEEDED_USERS = [
  { email: 'admin@clinic.local', portal: 'admin', firstName: 'Amal', name: 'Amal Haddad' },
  { email: 'staff@clinic.local', portal: 'staff', firstName: 'Rami', name: 'Rami Khoury' },
  { email: 'doctor@clinic.local', portal: 'doctor', firstName: 'Nabil', name: 'Nabil Saad' },
  { email: 'patient@clinic.local', portal: 'patient', firstName: 'Sara', name: 'Sara Karam' },
] as const

/**
 * The page's own message. Scoped to <main> because Next.js also renders an empty
 * role="alert" route announcer on every page, which a bare getByRole('alert') matches too.
 */
export function formAlert(page: Page): Locator {
  return page.getByRole('main').getByRole('alert')
}

export async function fillSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/**
 * Returns once the sign-in request has been answered, successful or not. Returning on the click
 * alone let a following page.goto cancel the request in flight, leaving the page signed out.
 */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST',
  )
  await fillSignIn(page, email, password)
  await answered
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
}

export async function accessTokenOf(page: Page): Promise<string> {
  const cookie = (await page.context().cookies()).find(
    (candidate) => candidate.name === 'clinic_at',
  )
  if (!cookie) throw new Error('no access token cookie')
  return cookie.value
}
