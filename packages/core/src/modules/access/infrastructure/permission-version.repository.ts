import { ClinicModel } from '@clinic/db'
import { sessionOf, type Transaction } from '../../../transaction'

/**
 * permissionVersion lives on the clinic document, but its meaning belongs to access (section
 * 7.7): bumping it makes every signed-in session re-resolve its grants on its next request.
 */
export const permissionVersionRepository = {
  async bump(clinicId: string, tx?: Transaction): Promise<void> {
    await ClinicModel().updateOne(
      { _id: clinicId },
      { $inc: { permissionVersion: 1 } },
      { session: sessionOf(tx) },
    )
  },
}
