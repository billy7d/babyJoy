import {
  DEFAULT_STORE_SETTINGS,
  STORE_SETTING_KEYS,
  STORE_SETTINGS_LIMITS,
  type StoreSettings,
  validateStoreSettingsInput,
  withStoreSettingsFallback,
} from "../shared/store-settings";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function failure(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    status,
  );
}

async function readBoundedJson(request: Request) {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > STORE_SETTINGS_LIMITS.payloadBytes
    )
      throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > STORE_SETTINGS_LIMITS.payloadBytes)
    throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

type StoreSettingsRow = { key: string; value: string };

function d1OperationFailed(value: unknown) {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === "object" &&
    "success" in value &&
    (value as { success?: unknown }).success === false
  );
}

export async function loadStoreSettings(env: Env): Promise<StoreSettings> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)",
  )
    .bind(...STORE_SETTING_KEYS)
    .all<StoreSettingsRow>();
  if (d1OperationFailed(result)) throw new Error("STORE_SETTINGS_READ_FAILED");
  const values = new Map(result.results.map((row) => [row.key, row.value]));
  return withStoreSettingsFallback({
    ...(values.has("store_display_name")
      ? { displayName: values.get("store_display_name") }
      : {}),
    ...(values.has("store_contact_email")
      ? { contactEmail: values.get("store_contact_email") }
      : {}),
    ...(values.has("store_contact_phone")
      ? { contactPhone: values.get("store_contact_phone") }
      : {}),
  });
}

export async function getAdminStoreSettings(env: Env) {
  return json({ success: true, data: await loadStoreSettings(env) });
}

export async function getPublicStoreSettings(env: Env) {
  const settings = await loadStoreSettings(env);
  // Keep this response deliberately allow-listed. app_settings also contains
  // seller, access, checkout and other private operational values.
  return json({
    success: true,
    data: {
      displayName: settings.displayName,
      contactEmail: settings.contactEmail,
      contactPhone: settings.contactPhone,
    },
  });
}

export async function saveAdminStoreSettings(request: Request, env: Env) {
  let value: unknown;
  try {
    value = await readBoundedJson(request);
  } catch (caught) {
    if (caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE")
      return failure(
        "PAYLOAD_TOO_LARGE",
        "Thông tin cửa hàng vượt giới hạn cho phép.",
        413,
      );
    return failure(
      "STORE_SETTINGS_VALIDATION_ERROR",
      "Thông tin cửa hàng chưa hợp lệ.",
      422,
    );
  }

  const validated = validateStoreSettingsInput(value);
  if (!validated.ok)
    return failure(
      validated.issue.code,
      validated.issue.message,
      422,
      { field: validated.issue.field },
    );

  const settings = validated.data;
  const updatedAt = new Date().toISOString();
  const values = [
    settings.displayName,
    settings.contactEmail,
    settings.contactPhone,
  ];
  try {
    const results = await env.DB.batch(
      STORE_SETTING_KEYS.map((key, index) =>
        env.DB.prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).bind(key, values[index], updatedAt),
      ),
    );
    if (results.some((result) => d1OperationFailed(result)))
      throw new Error("STORE_SETTINGS_WRITE_FAILED");
  } catch {
    return failure(
      "STORE_SETTINGS_SAVE_FAILED",
      "Chưa thể lưu thông tin cửa hàng.",
      500,
    );
  }

  return json({ success: true, data: settings });
}

export { DEFAULT_STORE_SETTINGS };
