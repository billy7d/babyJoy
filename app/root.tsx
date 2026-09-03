import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import "./admin-cart-requests.css";
import "./mobile-cart.css";
import "./product-description.css";
import "./product-description-heading.css";

export const links: Route.LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

function routeErrorPath() {
  const candidate = (globalThis as { location?: { pathname?: unknown } })
    .location?.pathname;
  return typeof candidate === "string" && candidate ? candidate : "unknown";
}

function redactedRouteErrorPath(path: string) {
  if (path.startsWith("/access/")) return "/access/[REDACTED]";
  return path.slice(0, 200);
}

function reportRouteError(error: unknown) {
  const routeError = isRouteErrorResponse(error);
  const rawType = routeError
    ? "ROUTE_ERROR"
    : error instanceof Error
      ? error.name
      : "UNKNOWN";
  const errorType = /^[A-Za-z0-9_.-]{1,64}$/.test(rawType)
    ? rawType
    : "UNKNOWN";
  console.error(
    JSON.stringify({
      message: "route render error",
      path: redactedRouteErrorPath(routeErrorPath()),
      errorType,
      errorCode: routeError ? `HTTP_${error.status}` : undefined,
    }),
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  reportRouteError(error);
  let message = "Đã có lỗi xảy ra";
  let details = "Ứng dụng chưa thể tải nội dung này.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Lỗi";
    details =
      error.status === 404
        ? "Không tìm thấy trang bạn yêu cầu."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="not-found">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
