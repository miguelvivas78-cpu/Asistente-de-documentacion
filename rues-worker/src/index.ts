type Env = {};

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
}

function normalizeNit(nit: string) {
  return nit.replace(/[^\d]/g, "");
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true });
    }

    if (url.pathname !== "/rues") {
      return json({ success: false, error: "Not found" }, { status: 404 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed" }, { status: 405 });
    }

    const body = await readJson<{ nit?: string }>(request);
    const nit = normalizeNit(body?.nit || url.searchParams.get("nit") || "");
    if (!nit) return json({ success: false, error: "NIT no proporcionado" }, { status: 400 });

    const cacheKey = new Request(`https://cache.local/rues?nit=${nit}`);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) {
      const res = new Response(cached.body, cached);
      res.headers.set("access-control-allow-origin", "*");
      return res;
    }

    // Fuente pública (datos.gov.co). Es rápida y no requiere navegador.
    const upstreamUrl = `https://www.datos.gov.co/resource/c82u-588k.json?nit=${encodeURIComponent(nit)}&$limit=1`;
    const upstream = await fetch(upstreamUrl, {
      headers: { accept: "application/json" },
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return json(
        { success: false, error: "Error al consultar RUES", status: upstream.status, detail: text.slice(0, 500) },
        { status: 502, headers: { "access-control-allow-origin": "*" } }
      );
    }

    let rows: any[] = [];
    try {
      rows = JSON.parse(text);
    } catch {
      return json(
        { success: false, error: "Respuesta inválida del proveedor" },
        { status: 502, headers: { "access-control-allow-origin": "*" } }
      );
    }

    const row = rows?.[0];
    if (!row) {
      return json(
        { success: false, error: "NIT no arrojó resultados" },
        { status: 200, headers: { "access-control-allow-origin": "*" } }
      );
    }

    const response = json(row, { status: 200, headers: { "access-control-allow-origin": "*" } });
    // Cache for 24h
    response.headers.set("cache-control", "public, max-age=86400");
    await cache.put(cacheKey, response.clone());
    return response;
  },
};

