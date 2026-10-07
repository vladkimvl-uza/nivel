// initData verification, message templates, callback_data codec and the text helpers of the bot (ARCHITECTURE 7). Owner — WP-13.
export {
  actCallback,
  CALLBACK_DATA_MAX_BYTES,
  type DecodedCallback,
  decodeCallback,
  encodeCallback,
  hexToUuid,
  leadCallback,
  orderCallback,
  uuidToHex,
} from "./callback.ts";
export { BOT_COMMANDS, type BotCommand, botCommands, botProfile } from "./commands.ts";
export {
  INIT_DATA_MAX_AGE_SECONDS,
  type InitDataResult,
  type InitDataUser,
  verifyInitData,
} from "./init-data.ts";
export { botTranslator, langOf } from "./messages.ts";
export { isActPhotoCaption, parseReceiptCaption, stripOwnerNotes } from "./staff-text.ts";
export {
  type InlineButton,
  keyboardMarkup,
  OUTBOX_TEMPLATE_KEYS,
  type OutboxTelegramPayload,
  type RenderedMessage,
  renderOutboxMessage,
  sumText,
  UnknownTemplateError,
} from "./templates.ts";
