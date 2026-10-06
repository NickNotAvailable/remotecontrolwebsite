import {
  defineConfig,
  type Plugin,
  type ViteDevServer,
  type PreviewServer,
} from "vite";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain JS modules shared with the production server
import { createRelay } from "./server/relay.js";
// @ts-expect-error — plain JS modules shared with the production server
import { networkInfo } from "./server/network.js";

/**
 * Mounts the pairing relay (WebSocket on /rc) and the /api/network helper on Vite's own HTTP
 * server, so `npm run dev` is a single process on a single port that phones on the LAN can reach.
 */
function pairingRelay(): Plugin {
  const attach = (
    server: ViteDevServer | PreviewServer,
    port: () => number,
  ) => {
    const relay = createRelay();
    server.httpServer?.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url || "/", "http://localhost");
      if (pathname === "/rc") relay.handleUpgrade(req, socket, head);
      // anything else (Vite HMR) is left alone
    });
    server.httpServer?.on("close", () => relay.close());
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/api/network") {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify(networkInfo({ port: port(), protocol: "http" })),
        );
        return;
      }
      if (url.pathname === "/healthz") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, ...relay.stats() }));
        return;
      }
      // Clean URL for the phone remote: /remote?session=ABC123 → remote/index.html
      if (url.pathname === "/remote") req.url = "/remote/" + url.search;
      next();
    });
  };
  const portOf = (server: ViteDevServer | PreviewServer) => () => {
    const addr = server.httpServer?.address();
    return typeof addr === "object" && addr ? addr.port : 5173;
  };
  return {
    name: "pairing-relay",
    configureServer(server) {
      attach(server, portOf(server));
    },
    configurePreviewServer(server) {
      attach(server, portOf(server));
    },
  };
}

/**
 * `vite build --mode static` → dist-static/: the TV only, with relative paths and pairing switched
 * off, for hosting as plain files where no relay can run (previews, file shares, sub-paths).
 */
export default defineConfig(({ mode }) => {
  const isStatic = mode === "static";
  return {
    base: isStatic ? "./" : "/",
    define: isStatic
      ? { "import.meta.env.VITE_PAIRING": JSON.stringify("off") }
      : {},
    plugins: [pairingRelay()],
    server: {
      host: true, // listen on the LAN so a phone can open the remote
      port: 5173,
    },
    preview: {
      host: true,
      port: 4173,
    },
    build: {
      target: "es2020",
      outDir: isStatic ? "dist-static" : "dist",
      rollupOptions: {
        input: isStatic
          ? { tv: fileURLToPath(new URL("./index.html", import.meta.url)) }
          : {
              tv: fileURLToPath(new URL("./index.html", import.meta.url)),
              remote: fileURLToPath(
                new URL("./remote/index.html", import.meta.url),
              ),
            },
      },
    },
  };
});
