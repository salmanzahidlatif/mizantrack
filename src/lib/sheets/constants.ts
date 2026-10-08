export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_SHEETS_BASE_SCOPE = "openid email profile";
export const GOOGLE_SHEETS_INCREMENTAL_SCOPE = `${GOOGLE_SHEETS_BASE_SCOPE} ${GOOGLE_DRIVE_FILE_SCOPE}`;

export const SHEETS_BACKUP_APP_PROPERTY = "mizantrackBackup";
export const SHEETS_BACKUP_APP_PROPERTY_VALUE = "v1";
export const SHEETS_BACKUP_CURRENCY_PROPERTY = "mizantrackCurrency";
export const SHEETS_BACKUP_USER_PROPERTY = "mizantrackUserId";
export const SHEETS_BACKUP_SCHEMA_VERSION = 1;
export const SHEETS_META_TAB = "_Meta";
export const SHEETS_CHUNK_MAX_BYTES = 750_000;
export const SHEETS_STALE_IN_PROGRESS_MS = 5 * 60_000;
