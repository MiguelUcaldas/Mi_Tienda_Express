// Utilidades de texto, nombres visibles y paginación. Funciones puras.

export function escaparHtml(texto: string | null | undefined): string {
  return (texto ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const NOMBRES_MEDIO_PAGO: Record<string, string> = {
  llave_breb: "Llave Bre-B",
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  contra_entrega: "Contra entrega",
};

export const NOMBRES_MEDIO_CORTO: Record<string, string> = {
  llave_breb: "Bre-B",
  nequi: "Nequi",
  bancolombia: "Bancolombia",
  contra_entrega: "Contra entrega",
};

// En recogida, contra entrega se muestra como "Pagar al recoger" (RN-24)
export function nombreMedioPago(tipo: string, modalidad?: string): string {
  if (tipo === "contra_entrega" && modalidad === "recogida") return "Pagar al recoger";
  return NOMBRES_MEDIO_PAGO[tipo] ?? tipo;
}

export const NOMBRES_UNIDAD: Record<string, string> = {
  unidad: "Unidad",
  kg: "Kg",
  libra: "Libra",
  paquete: "Paquete",
};

export const NOMBRES_ESTADO: Record<string, string> = {
  esperando_tienda: "⏳ Esperando a la tienda",
  esperando_confirmacion_cliente: "🛵 Esperando que aceptes el domicilio",
  esperando_pago: "💳 Esperando el pago",
  verificando_pago: "🧾 Verificando el pago",
  en_preparacion: "👩‍🍳 En preparación",
  listo: "📦 Listo",
  despachado: "🛵 En camino",
  entregado: "✅ Entregado",
  cancelado: "❌ Cancelado",
};

export const NOMBRES_MOTIVO: Record<string, string> = {
  rechazado_por_tienda: "La tienda no pudo tomarlo",
  sin_respuesta_tienda: "La tienda no respondió a tiempo",
  rechazo_tarifa: "No aceptaste el valor del domicilio",
  sin_respuesta_cliente: "No se aceptó el valor del domicilio a tiempo",
  sin_comprobante: "No llegó el comprobante de pago a tiempo",
  cancelado_por_cliente: "Cancelado por el cliente",
  cancelado_por_tienda: "Cancelado por la tienda",
};

export interface Pagina<T> {
  items: T[];
  pagina: number;
  totalPaginas: number;
}

// Páginas numeradas desde 1
export function paginar<T>(items: T[], pagina: number, tamano: number): Pagina<T> {
  const totalPaginas = Math.max(1, Math.ceil(items.length / tamano));
  const actual = Math.min(Math.max(1, pagina || 1), totalPaginas);
  const inicio = (actual - 1) * tamano;
  return { items: items.slice(inicio, inicio + tamano), pagina: actual, totalPaginas };
}

export function quitarTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// "Minimercado La Esquina" → "minimercado_la_esquina" (máx. 40)
export function generarSlug(nombre: string): string {
  const base = quitarTildes(nombre.toLowerCase())
    .replace(/ñ/g, "n")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return base || "tienda";
}

// Si el slug ya existe agrega _2, _3...
export function slugDisponible(base: string, existentes: string[]): string {
  if (!existentes.includes(base)) return base;
  let n = 2;
  while (existentes.includes(`${base.slice(0, 40 - String(n).length - 1)}_${n}`)) n++;
  return `${base.slice(0, 40 - String(n).length - 1)}_${n}`;
}

// Teléfono de 7 a 13 dígitos; acepta espacios, guiones y "+"
export function normalizarTelefono(texto: string): string | null {
  const digitos = texto.replace(/[\s\-()+]/g, "");
  if (!/^\d{7,13}$/.test(digitos)) return null;
  return digitos;
}

export function nombreCompleto(nombre?: string, apellido?: string): string {
  return [nombre, apellido].filter(Boolean).join(" ").trim();
}
