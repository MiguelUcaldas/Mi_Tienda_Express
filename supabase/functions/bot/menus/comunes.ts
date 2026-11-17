// Piezas de teclado reutilizables: paginación, cancelar, comunas y barrios.
import { InlineKeyboard } from "npm:grammy@^1";
import { NADA } from "../datos_callback.ts";
import { type Pagina, paginar } from "../logica/formato.ts";
import type { Barrio, Comuna } from "../servicios/barrios.ts";

export const TAMANO_PAGINA = 5;
export const TAMANO_PAGINA_BARRIOS = 8;

export const DATO_CANCELAR = "m:cx";

export function tecladoCancelar(): InlineKeyboard {
  return new InlineKeyboard().text("❌ Cancelar", DATO_CANCELAR);
}

// [⬅️ Anterior] [Página 2/4] [Siguiente ➡️]
export function agregarPaginacion<T>(
  teclado: InlineKeyboard,
  pagina: Pagina<T>,
  datoPagina: (p: number) => string,
) {
  if (pagina.totalPaginas <= 1) return;
  if (pagina.pagina > 1) teclado.text("⬅️ Anterior", datoPagina(pagina.pagina - 1));
  teclado.text(`Página ${pagina.pagina}/${pagina.totalPaginas}`, NADA);
  if (pagina.pagina < pagina.totalPaginas) teclado.text("Siguiente ➡️", datoPagina(pagina.pagina + 1));
  teclado.row();
}

export function tecladoComunas(comunas: Comuna[], datoComuna: (orden: number) => string): InlineKeyboard {
  const teclado = new InlineKeyboard();
  comunas.forEach((c, i) => {
    teclado.text(c.comuna, datoComuna(c.orden_comuna));
    if (i % 2 === 1) teclado.row();
  });
  teclado.row();
  return teclado;
}

// Lista de barrios de 8 en 8; `etiqueta` permite agregar la tarifa u otro dato al nombre
export function tecladoBarrios(
  barrios: Barrio[],
  pagina: number,
  datoBarrio: (id: number) => string,
  datoPagina: (p: number) => string,
  etiqueta: (b: Barrio) => string = (b) => b.nombre,
): InlineKeyboard {
  const teclado = new InlineKeyboard();
  const pag = paginar(barrios, pagina, TAMANO_PAGINA_BARRIOS);
  pag.items.forEach((b, i) => {
    teclado.text(etiqueta(b), datoBarrio(b.id));
    if (i % 2 === 1) teclado.row();
  });
  teclado.row();
  agregarPaginacion(teclado, pag, datoPagina);
  return teclado;
}
