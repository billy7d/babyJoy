import { STORE_BRAND } from "./branding";

export type StoreSettings = {
  displayName: string;
  contactEmail: string;
  contactPhone: string;
};

export const STORE_SETTING_KEYS = [
  "store_display_name",
  "store_contact_email",
  "store_contact_phone",
] as const;

export type StoreSettingKey = (typeof STORE_SETTING_KEYS)[number];

export const STORE_SETTINGS_LIMITS = {
  displayName: 120,
  contactEmail: 254,
  contactPhone: 64,
  payloadBytes: 16 * 1024,
} as const;

export const DEFAULT_STORE_SETTINGS: Readonly<StoreSettings> = Object.freeze({
  displayName: STORE_BRAND,
  contactEmail: "hello@babyjoy.vn",
  contactPhone: "1900 123 456",
});

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function recordValue(value: unknown, key: keyof StoreSettings) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function characterCount(value: string) {
  return Array.from(value).length;
}

export function normalizeStoreSettings(value: unknown): StoreSettings {
  return {
    displayName: recordValue(value, "displayName"),
    contactEmail: recordValue(value, "contactEmail"),
    contactPhone: recordValue(value, "contactPhone"),
  };
}

/**
 * Applies fallback values only when a setting is absent or unusable. An
 * explicitly saved blank contact value remains blank because blank contacts
 * are valid business values.
 */
export function withStoreSettingsFallback(value: unknown): StoreSettings {
  const normalized = normalizeStoreSettings(value);
  return {
    displayName: normalized.displayName || DEFAULT_STORE_SETTINGS.displayName,
    contactEmail:
      typeof (value as Record<string, unknown> | null)?.contactEmail === "string"
        ? normalized.contactEmail
        : DEFAULT_STORE_SETTINGS.contactEmail,
    contactPhone:
      typeof (value as Record<string, unknown> | null)?.contactPhone === "string"
        ? normalized.contactPhone
        : DEFAULT_STORE_SETTINGS.contactPhone,
  };
}

export function isStoreSettings(value: unknown): value is StoreSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.displayName === "string" &&
    candidate.displayName.trim().length > 0 &&
    typeof candidate.contactEmail === "string" &&
    typeof candidate.contactPhone === "string"
  );
}

export type StoreSettingsValidationIssue = {
  code: "STORE_SETTINGS_VALIDATION_ERROR";
  field: keyof StoreSettings;
  message: string;
};

export type StoreSettingsValidationResult =
  | { ok: true; data: StoreSettings }
  | { ok: false; issue: StoreSettingsValidationIssue };

export function validateStoreSettingsInput(
  value: unknown,
): StoreSettingsValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "displayName",
        message: "Thông tin cửa hàng chưa hợp lệ.",
      },
    };

  const input = value as Record<string, unknown>;
  const invalidType = (field: keyof StoreSettings) =>
    Object.prototype.hasOwnProperty.call(input, field) &&
    input[field] !== undefined &&
    typeof input[field] !== "string";
  for (const field of ["displayName", "contactEmail", "contactPhone"] as const) {
    if (invalidType(field))
      return {
        ok: false,
        issue: {
          code: "STORE_SETTINGS_VALIDATION_ERROR",
          field,
          message: "Giá trị cài đặt phải là chuỗi.",
        },
      };
  }

  const settings = normalizeStoreSettings(value);
  if (!settings.displayName)
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "displayName",
        message: "Tên hiển thị không được để trống.",
      },
    };
  if (characterCount(settings.displayName) > STORE_SETTINGS_LIMITS.displayName)
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "displayName",
        message: `Tên hiển thị không được dài quá ${STORE_SETTINGS_LIMITS.displayName} ký tự.`,
      },
    };
  if (CONTROL_CHARACTER_PATTERN.test(settings.displayName))
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "displayName",
        message: "Tên hiển thị không được chứa ký tự điều khiển.",
      },
    };

  if (settings.contactEmail.length > STORE_SETTINGS_LIMITS.contactEmail)
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "contactEmail",
        message: `Email liên hệ không được dài quá ${STORE_SETTINGS_LIMITS.contactEmail} ký tự.`,
      },
    };
  if (settings.contactEmail && !EMAIL_PATTERN.test(settings.contactEmail))
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "contactEmail",
        message: "Email liên hệ chưa đúng định dạng.",
      },
    };
  if (CONTROL_CHARACTER_PATTERN.test(settings.contactEmail))
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "contactEmail",
        message: "Email liên hệ không được chứa ký tự điều khiển.",
      },
    };

  if (settings.contactPhone.length > STORE_SETTINGS_LIMITS.contactPhone)
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "contactPhone",
        message: `Số điện thoại không được dài quá ${STORE_SETTINGS_LIMITS.contactPhone} ký tự.`,
      },
    };
  if (CONTROL_CHARACTER_PATTERN.test(settings.contactPhone))
    return {
      ok: false,
      issue: {
        code: "STORE_SETTINGS_VALIDATION_ERROR",
        field: "contactPhone",
        message: "Số điện thoại không được chứa ký tự điều khiển.",
      },
    };

  return { ok: true, data: settings };
}
