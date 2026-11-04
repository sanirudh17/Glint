export const CARD_IDLE_MS = 8_000;
export interface CardExpiry { remaining: number; paused: boolean; }
export function advanceExpiry(card: CardExpiry, elapsed: number): CardExpiry {
  return card.paused ? card : { ...card, remaining: Math.max(0, card.remaining - Math.max(0, elapsed)) };
}
