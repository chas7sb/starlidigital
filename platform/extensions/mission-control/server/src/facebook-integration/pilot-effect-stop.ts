import type { Store } from '../store.js';

const collection = 'facebook-customer-pilot-operator-controls';
const stopId = 'provider-effects-stopped';

/** Trusted operator wiring only. All workers must use the same pilot Store. */
export function stopFacebookCustomerPilotEffects(store: Store): void {
  store.put(collection, { id:stopId, stoppedAt:new Date().toISOString() });
}

/** Check synchronously at each effect boundary. A read error fails closed. */
export function assertFacebookCustomerPilotEffectsAllowed(store: Store): void {
  if (store.get(collection, stopId)) throw Error('CUSTOMER_PILOT_EFFECTS_STOPPED');
}
