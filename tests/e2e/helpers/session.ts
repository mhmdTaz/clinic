import { expect, type Locator, type Page } from '@playwright/test'

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

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await fillSignIn(page, email, password)
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
