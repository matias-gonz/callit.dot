import { file } from "bun";
import index from "./index.html";

const ROOT = import.meta.dir;
const PORT = Number(process.env.PORT ?? 1948);

const server = Bun.serve({
  port: PORT,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    "/": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.includes("..")) {
      return new Response("Bad request", { status: 400 });
    }

    const candidates = [
      `${ROOT}${pathname}`,
      `${ROOT}${pathname.replace(/\/$/, "")}/index.html`,
    ];

    for (const p of candidates) {
      const f = file(p);
      if (await f.exists()) {
        return new Response(f);
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  Callit slides → http://localhost:${server.port}\n`);
