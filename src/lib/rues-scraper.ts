import { createServerFn } from "@tanstack/react-start";
import puppeteer from "puppeteer";
import { getCiiuDescription } from "./ciiu-codes";

type RuesResult =
  | { success: true; data: string; razonSocial: string; estado: string }
  | { success: false; error: string };

const RUES_URL = "https://www.rues.org.co";
const RUES_API_URL = "https://elasticprd.rues.org.co/query";

type RuesApiHit = {
  _source?: Record<string, unknown>;
};

type RuesApiResponse = {
  hits?: RuesApiHit[];
};

// Single shared browser/page to avoid the ~10–30s overhead per request.
let shared:
  | {
      browser: Awaited<ReturnType<typeof puppeteer.launch>>;
      page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;
      ready: boolean;
    }
  | undefined;

// Serialize searches to keep a single page stable.
let queue: Promise<void> = Promise.resolve();

async function getSharedPage() {
  if (!shared) {
    const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    await page.setCacheEnabled(true);
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Speed up: block heavy assets we don't need for the API call.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") return req.abort();
      return req.continue();
    });

    shared = { browser, page, ready: false };
  }

  if (!shared.ready) {
    await shared.page.goto(RUES_URL, { waitUntil: "domcontentloaded" });
    // Best-effort close the initial popup (only once).
    try {
      await shared.page
        .waitForSelector("button.swal2-close", { timeout: 3000 })
        .then(() => shared!.page.$eval("button.swal2-close", (el) => (el as HTMLElement).click()))
        .catch(() => {});
    } catch {
      // ignore
    }
    shared.ready = true;
  }

  return shared.page;
}

async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const prev = queue;
  let release!: () => void;
  queue = new Promise<void>((r) => (release = r));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export const scrapeRues = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { nit: string } }): Promise<RuesResult> => {
    const { nit } = data;
    if (!nit || !nit.trim()) return { success: false, error: "NIT no proporcionado" };

    try {
      const apiData = await runExclusive(async () => {
        const page = await getSharedPage();

        // Ensure we are on the main page (rarely it may navigate away).
        if (!page.url().startsWith(RUES_URL)) {
          await page.goto(RUES_URL, { waitUntil: "domcontentloaded" });
        }

        await page.waitForSelector("#search", { timeout: 8000 });
        await page.focus("#search");
        // Clear input fast.
        await page.keyboard.down("Control");
        await page.keyboard.press("A");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");

        const wait = page.waitForResponse(
          (resp) => resp.url() === RUES_API_URL && resp.status() === 200,
          { timeout: 4500 }
        );

        await page.type("#search", nit.trim(), { delay: 0 });
        await page.keyboard.press("Enter");

        const response = await wait;
        const json = (await response.json()) as RuesApiResponse;
        const hit = json?.hits?.[0]?._source ?? null;
        return hit;
      });

      if (!apiData) return { success: false, error: "NIT no arrojó resultados" };

      // Extraer la información de actividad económica
      const ciiuPri = apiData.cod_ciiu_act_econ_pri as string | null;
      const ciiuSec = apiData.cod_ciiu_act_econ_sec as string | null;
      const razonSocial = (apiData.razon_social as string) || "Sin razón social";
      const estado = (apiData.desc_matricula as string) || "Desconocido";

      // Construir el texto de actividad económica con descripciones
      const activities: string[] = [];
      if (ciiuPri) activities.push(`CIIU ${ciiuPri} - ${getCiiuDescription(ciiuPri)}`);
      if (ciiuSec) activities.push(`CIIU ${ciiuSec} - ${getCiiuDescription(ciiuSec)}`);
      if (apiData.ciiu3) {
        const c3 = apiData.ciiu3 as string;
        activities.push(`CIIU ${c3} - ${getCiiuDescription(c3)}`);
      }
      if (apiData.ciiu4) {
        const c4 = apiData.ciiu4 as string;
        activities.push(`CIIU ${c4} - ${getCiiuDescription(c4)}`);
      }

      if (activities.length === 0) {
        return {
          success: false,
          error: "No se encontró información de actividad económica para este NIT",
        };
      }

      const activityText = `${razonSocial} — ${activities.join(" | ")} — Estado: ${estado}`;

      return {
        success: true,
        data: activityText,
        razonSocial,
        estado,
      };
    } catch (error) {
      console.error("Error en RUES scraper:", error);
      return {
        success: false,
        error:
          "Error al consultar RUES. La página puede estar bloqueando la petición o no respondiendo a tiempo.",
      };
    }
  });
