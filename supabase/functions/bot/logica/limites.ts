// Límite de productos del plan gratuito (RN-03 a RN-05). Funciones puras.

export function contarProductosParaLimite(productos: { eliminado: boolean }[]): number {
  return productos.filter((p) => !p.eliminado).length;
}

// Premium no tiene límite; sin Premium se puede crear mientras haya menos de `limite`
export function puedeCrearProducto(esPremium: boolean, productosNoEliminados: number, limite: number): boolean {
  if (esPremium) return true;
  return productosNoEliminados < limite;
}
