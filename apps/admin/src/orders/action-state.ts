// What a server action of the orders screens answers: the text to show next to the form. No secrets, no codes.
export interface ActionState {
  ok?: boolean;
  message?: string;
  /** Changes with every answer, so that the same text shown twice is drawn again (the form is not reset by it). */
  at?: number;
}

export const IDLE: ActionState = {};
