import { createServerFn } from "@tanstack/react-start";
import puppeteer from "puppeteer";
import { getCiiuDescription } from "./ciiu-codes";

type RuesResult =
  | { success: true; data: string; razonSocial: string; estado: string }
  | { success: false; error: string };

export const scrapeRues = createServerFn({ method: "POST" })
  .handler(async ({ data }: { data: { nit: string } }): Promise<RuesResult> => {
    const { nit } = data;
    if (!nit || !nit.trim()) return { success: false, error: "NIT no proporcionado" };

    let browser = null;
    try {
      const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      };
      // En Render, usamos Chromium del sistema vía variable de entorno
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }
      browser = await puppeteer.launch(launchOptions);

      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Capturar la respuesta de la API interna de RUES
      let apiData: Record<string, unknown> | null = null;
      page.on("response", async (response) => {
        if (
          response.url() === "https://elasticprd.rues.org.co/query" &&
          response.status() === 200
        ) {
          try {
            const json = await response.json();
            if (json.hits && json.hits.length > 0) {
              apiData = json.hits[0]._source;
            }
          } catch {
            // Respuesta no JSON, ignorar
          }
        }
      });

      await page.goto("https://www.rues.org.co", { waitUntil: "networkidle2" });

      // Cerrar el popup de SweetAlert2 que aparece al cargar la página
      try {
        await page.waitForSelector("button.swal2-close", { timeout: 5000 });
        await page.$eval("button.swal2-close", (el) => (el as HTMLElement).click());
        await page
          .waitForSelector(".swal2-container", { hidden: true, timeout: 3000 })
          .catch(() => {});
      } catch {
        // Si no aparece el popup, continuamos normalmente
      }

      // Buscar por NIT
      await page.waitForSelector("#search", { timeout: 8000 });
      await page.type("#search", nit.trim());
      await page.keyboard.press("Enter");

      // Esperar a que la API responda con datos (máx 10 segundos)
      const startTime = Date.now();
      while (!apiData && Date.now() - startTime < 10000) {
        await new Promise((r) => setTimeout(r, 500));
      }

      if (!apiData) {
        return { success: false, error: "NIT no arrojó resultados" };
      }

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
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  });
