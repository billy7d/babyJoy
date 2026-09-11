import { chromium, firefox, webkit } from "playwright";

const browserName = (process.env.BABYJOY_BROWSER ?? "chromium").toLowerCase();
const browserTypes = { chromium, firefox, webkit };

if (!Object.hasOwn(browserTypes, browserName))
  throw new Error(`BABYJOY_BROWSER không hợp lệ: ${browserName}`);

export const selectedBrowserName = browserName;
export const selectedBrowserType = browserTypes[browserName];

export function launchSelectedBrowser(options = {}) {
  return selectedBrowserType.launch({
    headless: true,
    ...(selectedBrowserName === "chromium" && process.env.CHROME_EXECUTABLE_PATH
      ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
      : {}),
    ...options,
  });
}
