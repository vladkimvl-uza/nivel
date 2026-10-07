// The limits of the Telegram Bot API for what the relay sends (ARCHITECTURE 7.1): one message a second to a chat, twenty a
// minute to a group, twenty-five a second in all. The throttle only keeps the times of the messages that went; it does not
// sleep: `reserve` answers how long to wait, and the relay leaves the row in the outbox for that long. Time is a parameter,
// so the tests run on a fake clock.

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const THROTTLE_LIMITS = {
  chatIntervalMs: SECOND,
  groupPerMinute: 20,
  allPerSecond: 25,
} as const;

export interface ChatRef {
  /** Telegram chat id: the user id of a customer, the negative id of a group. */
  id: number | string;
  group: boolean;
}

/** Times (ms) of the messages that went, newest last, kept as long as their window is open. */
type Times = number[];

function pruned(times: Times, from: number): Times {
  let i = 0;
  while (i < times.length && (times[i] as number) <= from) i++;
  return i === 0 ? times : times.slice(i);
}

export class Throttle {
  readonly #lastByChat = new Map<string, number>();
  readonly #groupTimes = new Map<string, Times>();
  #all: Times = [];

  /**
   * Answers 0 and records the message when it may go now, or the number of milliseconds to wait (nothing is recorded: a
   * refused attempt does not push the next one back).
   */
  reserve(chat: ChatRef, now: number): number {
    if (!Number.isFinite(now)) throw new RangeError("Throttle.reserve: now must be a number of milliseconds");
    this.#prune(now);
    const key = String(chat.id);
    let wait = 0;

    const last = this.#lastByChat.get(key);
    if (last !== undefined) wait = Math.max(wait, last + THROTTLE_LIMITS.chatIntervalMs - now);

    if (chat.group) {
      const times = this.#groupTimes.get(key) ?? [];
      if (times.length >= THROTTLE_LIMITS.groupPerMinute) {
        const oldest = times[times.length - THROTTLE_LIMITS.groupPerMinute] as number;
        wait = Math.max(wait, oldest + MINUTE - now);
      }
    }

    if (this.#all.length >= THROTTLE_LIMITS.allPerSecond) {
      const oldest = this.#all[this.#all.length - THROTTLE_LIMITS.allPerSecond] as number;
      wait = Math.max(wait, oldest + SECOND - now);
    }

    if (wait > 0) return wait;
    this.#lastByChat.set(key, now);
    if (chat.group) this.#groupTimes.set(key, [...(this.#groupTimes.get(key) ?? []), now]);
    this.#all.push(now);
    return 0;
  }

  /** How many chats the throttle still remembers (the tests watch that quiet chats are forgotten). */
  tracked(): number {
    return this.#lastByChat.size;
  }

  #prune(now: number): void {
    for (const [key, last] of this.#lastByChat) {
      if (last <= now - MINUTE) this.#lastByChat.delete(key);
    }
    for (const [key, times] of this.#groupTimes) {
      const kept = pruned(times, now - MINUTE);
      if (kept.length === 0) this.#groupTimes.delete(key);
      else if (kept !== times) this.#groupTimes.set(key, kept);
    }
    this.#all = pruned(this.#all, now - SECOND);
  }
}
