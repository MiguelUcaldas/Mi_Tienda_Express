// "📋 Pedidos" del personal: pendientes agrupados por estado e historial (11.12).
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { escaparHtml, paginar } from "../logica/formato.ts";
import { inicioPeriodo, NOMBRES_PERIODO, type Periodo } from "../logica/horarios.ts";
import { agregarPaginacion, TAMANO_PAGINA } from "../menus/comunes.ts";
import { ESTADO_PARA_TIENDA } from "../menus/tarjeta_pedido.ts";
import { exigirEnPedidos } from "../middleware/rol.ts";
import { historialTienda, pedidosNoFinales } from "../servicios/pedidos.ts";
import { mostrar } from "../ui.ts";

const PREFIJO = "pl";
const ORDEN_ESTADOS = [
  "esperando_tienda", "verificando_pago", "en_preparacion", "listo", "despachado",
  "esperando_confirmacion_cliente", "esperando_pago",
];

async function menu(ctx: MiContexto, tiendaId: number) {
  if (!await exigirEnPedidos(ctx, tiendaId, "gestionar_pedidos")) return;
  await mostrar(ctx, "📋 <b>Pedidos</b>", new InlineKeyboard()
    .text("⏳ Pendientes", armar(PREFIJO, "pend", tiendaId, 1)).text("📜 Historial", armar(PREFIJO, "hist", tiendaId, "hoy")).row()
    .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
}

async function pendientes(ctx: MiContexto, tiendaId: number, pagina: number) {
  if (!await exigirEnPedidos(ctx, tiendaId, "gestionar_pedidos")) return;
  const pedidos = (await pedidosNoFinales(tiendaId))
    .sort((a, b) => ORDEN_ESTADOS.indexOf(a.estado) - ORDEN_ESTADOS.indexOf(b.estado));
  const pag = paginar(pedidos, pagina, TAMANO_PAGINA);
  const lineas = ["⏳ <b>Pedidos pendientes</b>"];
  const teclado = new InlineKeyboard();
  let estadoActual = "";
  for (const p of pag.items) {
    if (p.estado !== estadoActual) {
      estadoActual = p.estado;
      lineas.push("", `<b>${ESTADO_PARA_TIENDA[p.estado]}</b>`);
    }
    lineas.push(`• ${numeroPedido(p.id)} · ${escaparHtml(p.nombre_cliente)} · ${formatearPesos(p.total)}${p.es_prueba ? " 🧪" : ""}`);
    teclado.text(`${numeroPedido(p.id)} · ${p.nombre_cliente}`, armar(P.pedidoTienda, "ver", p.id, "v")).row();
  }
  if (pedidos.length === 0) lineas.push("", "No hay pedidos pendientes 🙌");
  agregarPaginacion(teclado, pag, (n) => armar(PREFIJO, "pend", tiendaId, n));
  teclado.text("🔄 Actualizar", armar(PREFIJO, "pend", tiendaId, pag.pagina)).text("⬅️ Volver", armar(PREFIJO, "menu", tiendaId));
  await mostrar(ctx, lineas.join("\n"), teclado);
}

async function historial(ctx: MiContexto, tiendaId: number, periodo: Periodo) {
  if (!await exigirEnPedidos(ctx, tiendaId, "gestionar_pedidos")) return;
  const pedidos = await historialTienda(tiendaId, inicioPeriodo(periodo, new Date()));
  const lineas = [`📜 <b>Historial – ${NOMBRES_PERIODO[periodo]}</b> (últimos 20)`, ""];
  for (const p of pedidos) {
    lineas.push(`${p.estado === "entregado" ? "✅" : "❌"} ${numeroPedido(p.id)} · ${escaparHtml(p.nombre_cliente)} · ${formatearPesos(p.total)}${p.es_prueba ? " 🧪" : ""}`);
  }
  if (pedidos.length === 0) lineas.push("No hay pedidos en este periodo.");
  const marca = (x: Periodo) => (x === periodo ? "• " : "");
  await mostrar(ctx, lineas.join("\n"), new InlineKeyboard()
    .text(`${marca("hoy")}Hoy`, armar(PREFIJO, "hist", tiendaId, "hoy"))
    .text(`${marca("7d")}7 días`, armar(PREFIJO, "hist", tiendaId, "7d"))
    .text(`${marca("mes")}Este mes`, armar(PREFIJO, "hist", tiendaId, "mes")).row()
    .text("⬅️ Volver", armar(PREFIJO, "menu", tiendaId)));
}

async function manejarListas(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 2);
  if (partes[1] === "menu") await menu(ctx, tiendaId);
  if (partes[1] === "pend") await pendientes(ctx, tiendaId, num(partes, 3));
  if (partes[1] === "hist") {
    const periodo = (["hoy", "7d", "mes"].includes(partes[3]) ? partes[3] : "hoy") as Periodo;
    await historial(ctx, tiendaId, periodo);
  }
}

registrarCallback(PREFIJO, manejarListas);
