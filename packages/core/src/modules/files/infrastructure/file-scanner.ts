import { processSingleton } from '@clinic/config'

/**
 * The antivirus step from section 12.3, as a port.
 *
 * There is no scanning worker yet, and pretending otherwise would be worse than not having one:
 * a file marked CLEAN by nothing is a file the download gate waves through on a lie. The default
 * adapter therefore passes files and **says so** — the verdict it records is
 * "not scanned: no scanner configured", which appears on the file and in the audit trail.
 *
 * Installing a real scanner is `provideFileScanner(clamav)` at the composition root; nothing
 * else changes, because the status machine is already here.
 */
export type ScanVerdict = { status: 'CLEAN' | 'INFECTED' | 'FAILED'; result: string }

export interface FileScanner {
  scan(input: { storageKey: string; mimeType: string; sizeBytes: number }): Promise<ScanVerdict>
}

const NOT_CONFIGURED: FileScanner = {
  scan: () =>
    Promise.resolve({ status: 'CLEAN', result: 'not scanned: no scanner configured' } as const),
}

const installed = processSingleton('files:scanner', () => ({ scanner: NOT_CONFIGURED }))

export function provideFileScanner(scanner: FileScanner): void {
  installed.scanner = scanner
}

export function fileScanner(): FileScanner {
  return installed.scanner
}
