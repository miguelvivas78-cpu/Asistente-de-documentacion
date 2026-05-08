import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { scrapeRues } from "../lib/rues-scraper";
import { getCiiuDescription } from "../lib/ciiu-codes";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Copy, RotateCcw, FileText, Check, Settings, Plus, Trash2, ArrowUp, ArrowDown, Search } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

type FieldType = "text" | "textarea" | "select";

type FieldDef = {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  showWhen?: { fieldId: string; value: string };
};

type Config = {
  title: string;
  subtitle: string;
  badge: string;
  cardTitle: string;
  cardDescription: string;
  fields: FieldDef[];
};

const defaultConfig: Config = {
  title: "Asistente de documentación",
  subtitle: "Completa el formulario y obtén un resumen formateado listo para compartir.",
  badge: "Asistente de Documentación",
  cardTitle: "Datos del cliente",
  cardDescription: "Toda la información será incluida en el documento final.",
  fields: [
    { id: "dedicacion", label: "A qué se dedica la empresa", type: "text", required: true, placeholder: "Ej: Servicios contables" },
    { id: "contacto", label: "Nombre del contacto", type: "text", required: true, placeholder: "Juan Pérez" },
    { id: "rol", label: "Rol en la empresa", type: "select", required: true, options: ["Gerente", "Contador", "Dueño", "Auxiliar", "Otro"] },
    { id: "metodo", label: "¿Cómo trabajas hoy en día la contabilidad?", type: "select", required: true, options: ["Excel", "Software Local", "Software Nube", "Manual"] },
    { id: "necesidad", label: "¿Qué necesidad tienes?", type: "select", required: true, options: ["Automatización", "Cumplimiento Legal", "Reportes", "Migración"] },
    { id: "producto", label: "Producto cotizado", type: "select", required: true, options: ["Plan Básico", "Plan Pro", "Plan Enterprise"] },
    { id: "dependencia", label: "¿De qué depende la compra?", type: "select", required: true, options: ["Presupuesto", "Aprobación de socios", "Demo técnica", "Fecha límite"] },
    { id: "recomendado", label: "¿Es un recomendado?", type: "select", required: true, options: ["Sí", "No"] },
    { id: "recomendadoPor", label: "¿Quien lo recomienda?", type: "text", showWhen: { fieldId: "recomendado", value: "Sí" } },
    { id: "observaciones", label: "Observaciones o comentarios adicionales", type: "textarea", placeholder: "Notas adicionales..." },
  ],
};

const STORAGE_KEY = "doc-assistant-config-v2";
const ADMIN_PASSWORD = "123456789";

function loadConfig(): Config {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw);
    return { ...defaultConfig, ...parsed, fields: parsed.fields ?? defaultConfig.fields };
  } catch {
    return defaultConfig;
  }
}

function isVisible(f: FieldDef, values: Record<string, string>) {
  if (!f.showWhen) return true;
  return values[f.showWhen.fieldId] === f.showWhen.value;
}

function Index() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);
  const [nit, setNit] = useState("");
  const [isScraping, setIsScraping] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
  }, []);

  const update = (id: string, v: string) => setValues((p) => ({ ...p, [id]: v }));

  const handleScrape = async () => {
    if (!nit.trim()) {
      toast.error("Por favor ingresa un NIT");
      return;
    }
    setIsScraping(true);
    try {
      const ruesApiUrl = import.meta.env.VITE_RUES_API_URL as string | undefined;
      const res = ruesApiUrl
        ? await fetch(ruesApiUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ nit }),
          }).then((r) => r.json())
        : await scrapeRues({ data: { nit } });
      // External API returns a raw record (datos.gov.co). Convert to our expected shape.
      const normalized =
        res?.success !== undefined
          ? res
          : (() => {
              const razonSocial = res?.razon_social || "Sin razón social";
              const estado = res?.estado_matricula || "Desconocido";
              const ciiuPri = res?.cod_ciiu_act_econ_pri;
              const ciiuSec = res?.cod_ciiu_act_econ_sec;
              const activities: string[] = [];
              if (ciiuPri) activities.push(`CIIU ${ciiuPri} - ${getCiiuDescription(String(ciiuPri))}`);
              if (ciiuSec) activities.push(`CIIU ${ciiuSec} - ${getCiiuDescription(String(ciiuSec))}`);
              if (activities.length === 0) {
                return { success: false, error: "No se encontró actividad económica para este NIT" };
              }
              return {
                success: true,
                data: `${razonSocial} — ${activities.join(" | ")} — Estado: ${estado}`,
                razonSocial,
                estado,
              };
            })();

      if (normalized?.success && normalized?.data) {
        toast.success("Información extraída correctamente");
        const dedicacionField = config.fields.find(f => f.id === "dedicacion" || f.label.toLowerCase().includes("dedica"));
        if (dedicacionField) {
           update(dedicacionField.id, normalized.data);
        }
      } else {
        toast.error(normalized?.error || "NIT no arrojó resultados");
      }
    } catch (e) {
      toast.error("Error al conectar con el servidor de búsqueda");
    } finally {
      setIsScraping(false);
    }
  };

  const generate = () => {
    const text = config.fields
      .filter((f) => isVisible(f, values))
      .map((f) => `${f.label}: ${values[f.id] || "—"}`)
      .join("\n\n");
    setOutput(text);
    toast.success("Documentación generada");
  };

  const copy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast.success("Copiado al portapapeles");
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setValues({});
    setOutput("");
    toast("Formulario limpiado");
  };

  const canGenerate = useMemo(
    () =>
      config.fields
        .filter((f) => f.required && isVisible(f, values))
        .every((f) => (values[f.id] || "").trim().length > 0),
    [config.fields, values]
  );

  const saveConfig = (c: Config) => {
    setConfig(c);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="siigo-header-bar h-2 w-full" />
      <div className="py-10 px-4">
        <Toaster />
        <div className="mx-auto max-w-3xl">
          <header className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <FileText className="h-3.5 w-3.5" />
              {config.badge}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground font-display">
              {config.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{config.subtitle}</p>
          </header>

          <Card className="siigo-card">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-lg font-display">{config.cardTitle}</CardTitle>
              <CardDescription>{config.cardDescription}</CardDescription>
            </div>
            <AdminDialog config={config} onSave={saveConfig} />
          </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3 p-5 rues-box">
                <Label className="text-sm font-semibold text-primary flex items-center gap-2">
                  <Search className="h-4 w-4" /> Búsqueda en RUES (Opcional)
                </Label>
                <div className="flex gap-2">
                  <Input 
                    value={nit} 
                    onChange={(e) => setNit(e.target.value)} 
                    onKeyDown={(e) => { if (e.key === "Enter") handleScrape(); }}
                    placeholder="Ingresa el NIT para autocompletar la actividad" 
                    className="bg-background shadow-sm"
                  />
                  <Button onClick={handleScrape} disabled={isScraping} className="btn-siigo px-6">
                    {isScraping ? "Buscando..." : "Buscar"}
                  </Button>
                </div>
              </div>

            <div className="grid gap-5 sm:grid-cols-2">
              {config.fields.filter((f) => isVisible(f, values)).map((f) => (
                <div key={f.id} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                  <FieldRenderer field={f} value={values[f.id] || ""} onChange={(v) => update(f.id, v)} />
                </div>
              ))}
            </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={generate} disabled={!canGenerate} className="btn-siigo">
                  <FileText className="mr-2 h-4 w-4" /> Generar documentación
                </Button>
                <Button variant="outline" onClick={reset} className="border-primary/20 text-primary hover:bg-primary/5">
                  <RotateCcw className="mr-2 h-4 w-4" /> Limpiar formulario
                </Button>
              </div>
            </CardContent>
          </Card>

          {output && (
            <Card className="mt-6 siigo-card overflow-hidden">
              <CardHeader className="siigo-header-bar flex flex-row items-center justify-between space-y-0 text-white rounded-t-xl pb-4">
                <div>
                  <CardTitle className="text-lg text-white font-display">Documentación generada</CardTitle>
                  <CardDescription className="text-white/80">Revisa y copia el resumen.</CardDescription>
                </div>
                <Button onClick={copy} variant="secondary" size="sm" className="bg-white text-primary hover:bg-white/90 border-0 shadow-sm">
                  {copied ? <><Check className="mr-2 h-4 w-4" /> Copiado</> : <><Copy className="mr-2 h-4 w-4" /> Copiar</>}
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <pre className="whitespace-pre-wrap bg-muted/20 p-6 font-mono text-sm text-foreground m-0 border-t-0 rounded-b-xl">
{output}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRenderer({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        {field.label}{field.required ? " *" : ""}
      </Label>
      {field.type === "text" && (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      )}
      {field.type === "textarea" && (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} rows={4} />
      )}
      {field.type === "select" && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona una opción" />
          </SelectTrigger>
          <SelectContent>
            {(field.options || []).map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function AdminDialog({ config, onSave }: { config: Config; onSave: (c: Config) => void }) {
  const [open, setOpen] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState<Config>(config);

  useEffect(() => {
    if (!open) {
      setUnlocked(false);
      setPassword("");
    } else if (unlocked) {
      setDraft(JSON.parse(JSON.stringify(config)));
    }
  }, [open, unlocked, config]);

  const tryUnlock = () => {
    if (password === ADMIN_PASSWORD) {
      setUnlocked(true);
      toast.success("Acceso concedido");
    } else {
      toast.error("Contraseña incorrecta");
    }
  };

  const updateField = (idx: number, patch: Partial<FieldDef>) => {
    setDraft((d) => {
      const fields = [...d.fields];
      fields[idx] = { ...fields[idx], ...patch };
      return { ...d, fields };
    });
  };

  const removeField = (idx: number) => {
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const fields = [...d.fields];
      const target = idx + dir;
      if (target < 0 || target >= fields.length) return d;
      [fields[idx], fields[target]] = [fields[target], fields[idx]];
      return { ...d, fields };
    });
  };

  const addField = () => {
    const id = `campo_${Date.now()}`;
    setDraft((d) => ({
      ...d,
      fields: [...d.fields, { id, label: "Nuevo campo", type: "text", required: false }],
    }));
  };

  const save = () => {
    onSave(draft);
    toast.success("Configuración guardada");
    setOpen(false);
  };

  const restore = () => {
    setDraft(JSON.parse(JSON.stringify(defaultConfig)));
    toast("Restaurado a valores por defecto");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Settings className="mr-2 h-4 w-4" /> Administrador
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{unlocked ? "Configuración del formulario" : "Acceso de administrador"}</DialogTitle>
          <DialogDescription>
            {unlocked
              ? "Edita textos, campos y opciones. Los cambios se guardan en este navegador."
              : "Ingresa la contraseña para continuar."}
          </DialogDescription>
        </DialogHeader>

        {!unlocked ? (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Contraseña</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
              placeholder="••••••••"
              autoFocus
            />
          </div>
        ) : (
          <div className="space-y-6">
            <section className="space-y-3 rounded-md border border-border p-4">
              <h3 className="text-sm font-semibold">Encabezado</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Etiqueta superior</Label>
                  <Input value={draft.badge} onChange={(e) => setDraft((d) => ({ ...d, badge: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Título</Label>
                  <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Subtítulo</Label>
                  <Input value={draft.subtitle} onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Título de la tarjeta</Label>
                  <Input value={draft.cardTitle} onChange={(e) => setDraft((d) => ({ ...d, cardTitle: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Descripción de la tarjeta</Label>
                  <Input value={draft.cardDescription} onChange={(e) => setDraft((d) => ({ ...d, cardDescription: e.target.value }))} />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Campos del formulario</h3>
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="mr-1 h-4 w-4" /> Añadir campo
                </Button>
              </div>

              {draft.fields.map((f, idx) => (
                <div key={f.id} className="space-y-3 rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Nombre del campo</Label>
                          <Input value={f.label} onChange={(e) => updateField(idx, { label: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Tipo</Label>
                          <Select value={f.type} onValueChange={(v) => updateField(idx, { type: v as FieldType })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Texto</SelectItem>
                              <SelectItem value="textarea">Texto largo</SelectItem>
                              <SelectItem value="select">Desplegable</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {f.type !== "select" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Placeholder (opcional)</Label>
                          <Input value={f.placeholder || ""} onChange={(e) => updateField(idx, { placeholder: e.target.value })} />
                        </div>
                      )}

                      {f.type === "select" && (
                        <div className="space-y-1">
                          <Label className="text-xs">Opciones (una por línea)</Label>
                          <Textarea
                            rows={4}
                            value={(f.options || []).join("\n")}
                            onChange={(e) => updateField(idx, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                          />
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-center gap-2">
                          <Switch checked={!!f.required} onCheckedChange={(c) => updateField(idx, { required: c })} />
                          <Label className="text-xs">Obligatorio</Label>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Mostrar solo si... (opcional)</Label>
                          <div className="flex gap-2">
                            <Select
                              value={f.showWhen?.fieldId || "__none__"}
                              onValueChange={(v) =>
                                updateField(idx, v === "__none__" ? { showWhen: undefined } : { showWhen: { fieldId: v, value: f.showWhen?.value || "" } })
                              }
                            >
                              <SelectTrigger className="flex-1"><SelectValue placeholder="Campo" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Siempre visible</SelectItem>
                                {draft.fields.filter((o) => o.id !== f.id).map((o) => (
                                  <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {f.showWhen && (
                              <Input
                                className="flex-1"
                                placeholder="igual a..."
                                value={f.showWhen.value}
                                onChange={(e) => updateField(idx, { showWhen: { fieldId: f.showWhen!.fieldId, value: e.target.value } })}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <Button variant="ghost" size="icon" onClick={() => moveField(idx, -1)} disabled={idx === 0}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => moveField(idx, 1)} disabled={idx === draft.fields.length - 1}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => removeField(idx)} className="text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2">
          {unlocked && (
            <Button variant="ghost" onClick={restore} className="mr-auto text-muted-foreground">
              Restaurar por defecto
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          {unlocked ? (
            <Button onClick={save}>Guardar</Button>
          ) : (
            <Button onClick={tryUnlock}>Acceder</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
