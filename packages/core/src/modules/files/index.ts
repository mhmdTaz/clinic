/** Stored documents: the vault, chart attachments, and generated PDFs (S14, P6, section 12). */
export {
  presignUpload,
  confirmUpload,
  storeGeneratedFile,
  toStoredFile,
} from './application/upload'
export {
  listFiles,
  getFile,
  getDownloadLink,
  updateFile,
  deleteFile,
} from './application/directory'
export { installFileScopeResolvers } from './application/scope'
export { storageKeyFor, slugify } from './domain/storage-key'
export {
  provideFileScanner,
  type FileScanner,
  type ScanVerdict,
} from './infrastructure/file-scanner'
// NOT exported: the repository, or the object-storage client.
