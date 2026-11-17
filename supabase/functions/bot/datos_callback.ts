// Datos de los botones (callback_data): "prefijo:accion:id[:extra]", máximo 64 bytes.

export const P = {
  menu: "m", // menús generales
  categoria: "cat", // categorías y listas del cliente
  producto: "pr", // detalle de producto
  cantidad: "pq", // cantidad en el detalle
  agregar: "pa", // agregar al carrito
  carrito: "car",
  checkout: "chk",
  pedidoTienda: "ped", // acciones de la tienda sobre un pedido
  pedidoCliente: "cli", // acciones del cliente sobre un pedido
  pago: "pag",
  entrega: "ent", // domiciliario y código de entrega
  reabastecer: "rea",
  avisame: "avi",
  equipo: "eq",
  invitacion: "inv",
  promocion: "prom",
  tarifa: "tar",
  superAdmin: "sa",
  modoPruebas: "mp",
  registro: "rt", // registro de tienda
  miTienda: "cfg", // ⚙️ Mi tienda
  productosAdmin: "prd",
  categoriasAdmin: "ctg",
  inventario: "stk",
  reportes: "rep",
  ofertas: "of",
} as const;

const LIMITE_BYTES = 64;

export function armar(...partes: (string | number)[]): string {
  const dato = partes.join(":");
  if (new TextEncoder().encode(dato).length > LIMITE_BYTES) {
    throw new Error(`callback_data supera ${LIMITE_BYTES} bytes: ${dato}`);
  }
  return dato;
}

export function leer(dato: string): string[] {
  return dato.split(":");
}

// Lee un número de las partes; NaN si no es válido
export function num(partes: string[], indice: number): number {
  return parseInt(partes[indice] ?? "", 10);
}

// Botón que no hace nada (ej. "Página 2/4")
export const NADA = "m:nada";
