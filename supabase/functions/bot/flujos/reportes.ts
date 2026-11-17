// "📈 Reportes" (11.15). Ventas = solo pedidos entregados; los pedidos de prueba cuentan.
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos } from "../logica/calculos.ts";
import { escaparHtml, NOMBRES_MEDIO_CORTO } from "../logica/formato.ts";
import { inicioPeriodo, NOMBRES_PERIODO, type Periodo } from "../logica/horarios.ts";
import { exigir } from "../middleware/rol.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { mostrar } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.reportes, ...partes);

interface Reporte {
  pedidos: number;
  entregados: number;
  cancelados: number;
  en_curso: number;
  ventas: number;
  ticket_promedio: number;
  domicilio: number;
  recogida: number;
  medios: Record<string, number>;
  top: { nombre: string; unidades: number }[];
  agotados: string[];
  stock_bajo: { nombre: string; stock: number }[];
}

export function textoReporte(nombreTienda: string, periodo: Periodo, r: Reporte): string {
  const medios = ["nequi", "llave_breb", "bancolombia", "contra_entrega"]
    .map((m) => `${NOMBRES_MEDIO_CORTO[m]} ${r.medios?.[m] ?? 0}`).join(" · ");
  const lineas = [
    `📈 <b>Reporte de ${escaparHtml(nombreTienda)} – ${NOMBRES_PERIODO[periodo]}</b>`,
    `🧾 Pedidos: ${r.pedidos} (✅ ${r.entregados} entregados · ❌ ${r.cancelados} cancelados · ⏳ ${r.en_curso} en curso)`,
    `💰 Ventas (entregados): ${formatearPesos(r.ventas)} · Ticket promedio: ${formatearPesos(r.ticket_promedio)}`,
    `🛵 Domicilio: ${r.domicilio} · 🏪 Recogida: ${r.recogida}`,
    `💳 ${medios}`,
  ];
  if (r.top.length) {
    lineas.push("🏆 Más pedidos:");
    r.top.forEach((t, i) => lineas.push(` ${i + 1}. ${escaparHtml(t.nombre)} — ${t.unidades} und`));
  }
  lineas.push(`⛔ Agotados: ${r.agotados.length ? r.agotados.map(escaparHtml).join(", ") : "ninguno"}`);
  lineas.push(`⚠️ Stock bajo: ${r.stock_bajo.length ? r.stock_bajo.map((s) => `${escaparHtml(s.nombre)} (${s.stock})`).join(", ") : "ninguno"}`);
  return lineas.join("\n");
}

async function manejarReportes(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 2);
  if (!await exigir(ctx, tiendaId, "ver_reportes")) return;
  if (partes[1] === "menu") {
    await mostrar(ctx, "📈 <b>Reportes</b>\n¿Qué periodo quieres ver?", new InlineKeyboard()
      .text("Hoy", d("p", tiendaId, "hoy")).text("Últimos 7 días", d("p", tiendaId, "7d")).text("Este mes", d("p", tiendaId, "mes")).row()
      .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }
  const periodo = (["hoy", "7d", "mes"].includes(partes[3]) ? partes[3] : "hoy") as Periodo;
  const ahora = new Date();
  const [tienda, { data, error }] = await Promise.all([
    obtenerTienda(tiendaId),
    db.rpc("reporte_tienda", {
      p_tienda: tiendaId,
      p_desde: inicioPeriodo(periodo, ahora).toISOString(),
      p_hasta: new Date(ahora.getTime() + 60_000).toISOString(),
    }),
  ]);
  if (error || !data) {
    console.error("reporte_tienda:", error?.message);
    await mostrar(ctx, "😕 No pudimos generar el reporte. Intenta de nuevo.");
    return;
  }
  await mostrar(ctx, textoReporte(tienda?.nombre ?? "", periodo, data as Reporte), new InlineKeyboard()
    .text("Hoy", d("p", tiendaId, "hoy")).text("7 días", d("p", tiendaId, "7d")).text("Este mes", d("p", tiendaId, "mes")).row()
    .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
}

registrarCallback(P.reportes, manejarReportes);
