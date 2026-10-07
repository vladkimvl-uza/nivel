// A number of a bank card must reach neither a message of the bot nor a job of the queue (CLAUDE.md: the money for
// purchases goes to the account of the sole proprietor, never to a card). The queue refuses any sixteen digits in a row;
// the bot checks the same before it shows the requisites the owner typed.

/** Sixteen digits, alone or in groups of four, not a part of a longer run of digits. */
export const CARD_NUMBER = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;
const CARD_NUMBER_EVERY = new RegExp(CARD_NUMBER.source, "g");
/** The account of a company is twenty digits, often written in five groups of four: it is not a card. */
const ACCOUNT_OF_TWENTY = /(?<![0-9])[0-9]{4}(?:[ -]?[0-9]{4}){4}(?![0-9])/g;

export const looksLikeCard = (text: string): boolean => CARD_NUMBER.test(text.replace(ACCOUNT_OF_TWENTY, ""));

/** The words of a person with every card number cut out (for what is put into the queue). */
export const maskCardNumbers = (text: string): string => text.replace(CARD_NUMBER_EVERY, "[...]");
