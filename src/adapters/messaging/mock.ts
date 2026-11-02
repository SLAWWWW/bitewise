export interface MockSend { id: string; mode: 'DEMO' | 'TEST' | 'LIVE'; payload: { offer_id: string; contact_id: string; text: string }; fault: string | null }
export interface SendResult { state: 'DELIVERED' | 'SENT' | 'DELIVERY_UNKNOWN' | 'FAILED'; providerId: string | null }

/** No HTTP client, credentials or external records are reachable from this adapter. */
export async function sendMock(message: MockSend): Promise<SendResult> {
  if (message.mode === 'LIVE') throw new Error('LIVE_SEND_BLOCKED');
  if (message.fault === 'TIMEOUT' || message.fault === 'DELIVERY_UNKNOWN') return { state: 'DELIVERY_UNKNOWN', providerId: null };
  if (message.fault === 'FAILED') return { state: 'FAILED', providerId: null };
  if (message.fault === 'NO_DELIVERY_RECEIPT') return { state: 'SENT', providerId: `mock:${message.id}` };
  return { state: 'DELIVERED', providerId: `mock:${message.id}` };
}
