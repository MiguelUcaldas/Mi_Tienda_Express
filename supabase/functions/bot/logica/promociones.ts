// Promociones y precio vigente (RN-13 a RN-15). Fechas como "AAAA-MM-DD" en hora de Bogotá.

export type TipoPromocion = "porcentaje" | "precio_especial";

export interface Promocion {
  id?: number;
  producto_id?: number;
  tipo: TipoPromocion;
  valor: number;
  inicia_en: string;
  termina_en: string;
  activa: boolean;
}

export function promocionVigente(promo: Promocion, hoy: string): boolean {
  return promo.activa && promo.inicia_en <= hoy && promo.termina_en >= hoy;
}

// Vigente o programada para el futuro (RN-14)
export function promocionVigenteOProgramada(promo: Promocion, hoy: string): boolean {
  return promo.activa && promo.termina_en >= hoy;
}

export function aplicarPromocion(precio: number, promo: Promocion): number {
  if (promo.tipo === "porcentaje") return Math.round((precio * (100 - promo.valor)) / 100);
  return promo.valor;
}

export interface PrecioCalculado {
  precio: number;
  precioNormal: number;
  promocion: Promocion | null;
}

export function precioVigente(precio: number, promociones: Promocion[], hoy: string): PrecioCalculado {
  const vigente = promociones.find((p) => promocionVigente(p, hoy)) ?? null;
  return {
    precio: vigente ? aplicarPromocion(precio, vigente) : precio,
    precioNormal: precio,
    promocion: vigente,
  };
}

// Devuelve un mensaje de error o null si el valor es válido
export function validarValorPromocion(tipo: TipoPromocion, valor: number, precio: number): string | null {
  if (!Number.isInteger(valor) || valor <= 0) return "Escribe un número entero mayor que cero.";
  if (tipo === "porcentaje" && (valor < 1 || valor > 90)) return "El descuento debe estar entre 1 y 90 %.";
  if (tipo === "precio_especial" && valor >= precio) return "El precio especial debe ser menor al precio normal.";
  return null;
}

export function porcentajeDescuento(precioNormal: number, precioFinal: number): number {
  if (precioNormal <= 0) return 0;
  return Math.round((1 - precioFinal / precioNormal) * 100);
}
