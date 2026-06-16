// Derive a stable tenant uuid from a Google identity. Our DB columns are uuid,
// but NextAuth/Google identities (sub, email) are not uuids. We map email -> a
// deterministic uuid v5 under a fixed namespace, so the same Google account
// always resolves to the same user_id. Email is the canonical identity in the
// entity-resolution rules too, so this keeps tenancy and the graph aligned.

import { v5 as uuidv5 } from 'uuid'

// Fixed, app-specific namespace (a random uuid generated once for zrux).
const ZRUX_TENANT_NAMESPACE = 'b3f1c2a4-5d6e-4f70-8a91-2c3d4e5f6071'

export function deriveUserId(email: string): string {
  return uuidv5(email.trim().toLowerCase(), ZRUX_TENANT_NAMESPACE)
}
