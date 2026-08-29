import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
  // Vite build mặc định là production; chọn cùng Cloudflare environment trước khi plugin đọc wrangler.jsonc.
  if (
    command === "build" &&
    mode === "production" &&
    !process.env.CLOUDFLARE_ENV
  )
    process.env.CLOUDFLARE_ENV = "production";

  return {
    plugins: [
      cloudflare({ viteEnvironment: { name: "ssr" } }),
      tailwindcss(),
      reactRouter(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
  };
});
