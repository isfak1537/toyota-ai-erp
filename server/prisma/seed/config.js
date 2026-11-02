// Constants of the synthetic dataset (SRS section 11). Everything that makes
// the data reproducible lives here or in the CLI arguments.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SEED_DEFAULT = 20261102;
// Fixed on purpose: "same seed, same data" needs a fixed clock. Re-run with
// --end-date <today> before a demo; it stays deterministic per date.
const END_DATE_DEFAULT = "2026-11-01";
const DAYS = 90;

// Business time is Asia/Dhaka (UTC+6): 08:00-17:00 local = 02:00-11:00 UTC, the
// weekend is Friday and Saturday (SEED-002). Timestamps are stored in UTC, so
// normal events keep the same calendar date in UTC and local time. The anomaly
// model (P3) and the daily series (AI-001) must use the same convention.
const TZ_OFFSET_HOURS = 6;
const BUSINESS_START_UTC_HOUR = 2;
const BUSINESS_END_UTC_HOUR = 11;

const WEEKDAY_FACTOR = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 0.55, 6: 0.6 };

// Ownership markers: the replace operation only ever touches rows carrying
// these, so manual data in the same database is never deleted.
const COMPANY_CODE = "SYN-DEMO";
const FACTORY_CODE = "SYN-DHAKA";
const SKU_PREFIX = "SYN-";
const SUPPLIER_PREFIX = "SYN-";
const CATEGORY_PREFIX = "[SYN] ";

const parseEndDate = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

  if (match) {
    const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

    if (new Date(ms).toISOString().slice(0, 10) === text) {
      return ms;
    }
  }

  throw new Error(`Invalid end date "${text}" (expected YYYY-MM-DD)`);
};

const weekdayFactor = (dayMs) => WEEKDAY_FACTOR[new Date(dayMs).getUTCDay()];

module.exports = {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SEED_DEFAULT,
  END_DATE_DEFAULT,
  DAYS,
  TZ_OFFSET_HOURS,
  BUSINESS_START_UTC_HOUR,
  BUSINESS_END_UTC_HOUR,
  COMPANY_CODE,
  FACTORY_CODE,
  SKU_PREFIX,
  SUPPLIER_PREFIX,
  CATEGORY_PREFIX,
  parseEndDate,
  weekdayFactor,
};
