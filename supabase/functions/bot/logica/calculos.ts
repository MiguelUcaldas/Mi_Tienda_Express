// Cálculos de dinero y numeración. Pesos colombianos siempre enteros.

export interface ItemConPrecio {
  precio_unitario: number;
  cantidad: number;
}

export function calcularSubtotal(items: ItemConPrecio[]): number {
  return items.reduce((suma, item) => suma + item.precio_unitario * item.cantidad, 0);
}

export function calcularTotalPedido(subtotal: number, valorDomicilio: number): number {
  return subtotal + (valorDomicilio || 0);
}

// 17500 → "$17.500"
export function formatearPesos(valor: number): string {
  const entero = Math.round(Math.abs(valor));
  const conPuntos = entero.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${valor < 0 ? "-" : ""}$${conPuntos}`;
}

// 42 → "#0042"
export function numeroPedido(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

// Acepta "4.500", "4500", "$4.500" o "4 500". Devuelve null si no es un entero válido.
export function parsearPrecio(texto: string): number | null {
  const limpio = texto.trim().replace(/[$\s.]/g, "");
  if (!/^\d{1,9}$/.test(limpio)) return null;
  return parseInt(limpio, 10);
}

// Entero no negativo escrito por el usuario
export function parsearEntero(texto: string): number | null {
  const limpio = texto.trim();
  if (!/^\d{1,9}$/.test(limpio)) return null;
  return parseInt(limpio, 10);
}
