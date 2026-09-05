import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  DEFAULT_STORE_SETTINGS,
  isStoreSettings,
  withStoreSettingsFallback,
  type StoreSettings,
} from "../../shared/store-settings";

type StoreSettingsFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type StoreSettingsResponse = {
  success?: boolean;
  data?: unknown;
  error?: { message?: string };
};

export type StoreSettingsContextValue = StoreSettings & {
  loading: boolean;
  error: boolean;
};

const defaultContextValue: StoreSettingsContextValue = {
  ...DEFAULT_STORE_SETTINGS,
  loading: true,
  error: false,
};

const StoreSettingsContext = createContext<StoreSettingsContextValue>(
  defaultContextValue,
);

async function readResponseBody(response: Response) {
  return (await response.json().catch(() => ({}))) as StoreSettingsResponse;
}

function parseStoreSettingsResponse(body: StoreSettingsResponse) {
  if (!body.data || !isStoreSettings(body.data))
    throw new Error("STORE_SETTINGS_INVALID_RESPONSE");
  return withStoreSettingsFallback(body.data);
}

async function requestStoreSettings(
  path: string,
  init: RequestInit | undefined,
  fetcher: StoreSettingsFetcher,
) {
  const response = await fetcher(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await readResponseBody(response);
  if (!response.ok)
    throw new Error(body.error?.message || "Không tải được thông tin cửa hàng.");
  return parseStoreSettingsResponse(body);
}

export function getAdminStoreSettings(fetcher: StoreSettingsFetcher = fetch) {
  return requestStoreSettings("/api/admin/settings/store", undefined, fetcher);
}

export function getPublicStoreSettings(fetcher: StoreSettingsFetcher = fetch) {
  return requestStoreSettings("/api/store-settings", undefined, fetcher);
}

export async function saveAdminStoreSettings(
  settings: StoreSettings,
  fetcher: StoreSettingsFetcher = fetch,
) {
  const response = await fetcher("/api/admin/settings/store", {
    method: "PUT",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(settings),
  });
  const body = await readResponseBody(response);
  if (!response.ok)
    throw new Error(body.error?.message || "Chưa thể lưu thông tin cửa hàng.");
  return parseStoreSettingsResponse(body);
}

export function StoreSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(
    DEFAULT_STORE_SETTINGS,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const currentRequest = ++requestId.current;
    void getPublicStoreSettings()
      .then((next) => {
        if (requestId.current !== currentRequest) return;
        setSettings(next);
        setError(false);
      })
      .catch(() => {
        if (requestId.current !== currentRequest) return;
        // The shared fallback keeps the storefront usable if the public API
        // is temporarily unavailable or a legacy database has no new keys.
        setSettings(DEFAULT_STORE_SETTINGS);
        setError(true);
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoading(false);
      });
  }, []);

  return (
    <StoreSettingsContext.Provider value={{ ...settings, loading, error }}>
      {children}
    </StoreSettingsContext.Provider>
  );
}

export function useStoreSettings() {
  return useContext(StoreSettingsContext);
}
