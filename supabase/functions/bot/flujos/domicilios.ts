// "🛵 Domicilios" (11.14): tarifas guardadas por barrio y "No entrego".
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { formatearPesos, parsearPrecio } from "../logica/calculos.ts";
import { escaparHtml } from "../logica/formato.ts";
import { tecladoBarrios, tecladoCancelar, tecladoComunas } from "../menus/comunes.ts";
import { exigir } from "../middleware/rol.ts";
import { barriosDeComuna, listarComunas, obtenerBarrio } from "../servicios/barrios.ts";
import { iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import { mostrar, responder } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.tarifa, ...partes);

interface Tarifa {
  barrio_id: number;
  tarifa: number | null;
  entrega: boolean;
}

async function tarifasDe(tiendaId: number): Promise<Map<number, Tarifa>> {
  const { data } = await db.from("tarifas_domicilio").select("barrio_id, tarifa, entrega").eq("tienda_id", tiendaId);
  return new Map(((data ?? []) as Tarifa[]).map((t) => [t.barrio_id, t]));
}

function etiquetaTarifa(t?: Tarifa): string {
  if (!t) return "sin tarifa";
  if (!t.entrega) return "🚫 No entrego";
  return t.tarifa !== null ? formatearPesos(t.tarifa) : "sin tarifa";
}

async function menu(ctx: MiContexto, tiendaId: number) {
  await mostrar(ctx, "🛵 <b>Tarifas guardadas</b>\nEstas tarifas se guardan solas cada vez que cobras un domicilio. Aquí puedes ajustarlas.\n\nElige la comuna:",
    tecladoComunas(await listarComunas(), (o) => d("com", tiendaId, o)).text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
}

async function barrios(ctx: MiContexto, tiendaId: number, orden: number, pagina: number) {
  const [lista, tarifas] = await Promise.all([barriosDeComuna(orden), tarifasDe(tiendaId)]);
  await mostrar(ctx, "🛵 Elige el barrio:", tecladoBarrios(lista, pagina, (id) => d("bar", tiendaId, id), (p) => d("bpg", tiendaId, orden, p),
    (b) => `${b.nombre} · ${etiquetaTarifa(tarifas.get(b.id))}`).text("⬅️ Comunas", d("menu", tiendaId)));
}

async function detalleBarrio(ctx: MiContexto, tiendaId: number, barrioId: number, aviso = "") {
  const [barrio, tarifas] = await Promise.all([obtenerBarrio(barrioId), tarifasDe(tiendaId)]);
  if (!barrio) return;
  const t = tarifas.get(barrioId);
  const entrega = t?.entrega ?? true;
  await mostrar(ctx, `${aviso}${aviso ? "\n" : ""}📍 <b>${escaparHtml(barrio.nombre)}</b> (${escaparHtml(barrio.comuna)})\nTarifa: ${etiquetaTarifa(t)}`,
    new InlineKeyboard()
      .text("✏️ Cambiar tarifa", d("ct", tiendaId, barrioId))
      .text(entrega ? "🚫 No entrego" : "✅ Sí entrego", d(entrega ? "ne" : "se", tiendaId, barrioId)).row()
      .text("⬅️ Barrios", d("com", tiendaId, barrio.orden_comuna)));
}

async function guardar(tiendaId: number, barrioId: number, cambios: Partial<Tarifa>) {
  await db.from("tarifas_domicilio").upsert(
    { tienda_id: tiendaId, barrio_id: barrioId, ...cambios, actualizado_en: new Date().toISOString() },
    { onConflict: "tienda_id,barrio_id" },
  );
}

async function manejarTarifas(ctx: MiContexto, partes: string[]) {
  const tiendaId = num(partes, 2);
  if (!await exigir(ctx, tiendaId, "gestionar_tarifas")) return;
  const valor = num(partes, 3);
  switch (partes[1]) {
    case "menu": return await menu(ctx, tiendaId);
    case "com": return await barrios(ctx, tiendaId, valor, 1);
    case "bpg": return await barrios(ctx, tiendaId, valor, num(partes, 4));
    case "bar": return await detalleBarrio(ctx, tiendaId, valor);
    case "ne":
      await guardar(tiendaId, valor, { entrega: false });
      return await detalleBarrio(ctx, tiendaId, valor, "🚫 Listo, ya no entregas en este barrio.");
    case "se":
      await guardar(tiendaId, valor, { entrega: true });
      return await detalleBarrio(ctx, tiendaId, valor, "✅ Listo, vuelves a entregar en este barrio.");
    case "ct":
      await iniciarFlujo(ctx, "tarifa_barrio", "valor", { tienda_id: tiendaId, barrio_id: valor });
      return void await responder(ctx, "✏️ Escribe la nueva tarifa (ej. 4000):", tecladoCancelar());
  }
}

async function flujoTarifa(ctx: MiContexto) {
  const valor = parsearPrecio(ctx.message?.text ?? "");
  if (valor === null || valor > 200000) return void await responder(ctx, "Escribe solo el número, por ejemplo 4000 💵", tecladoCancelar());
  const { tienda_id, barrio_id } = ctx.estado.datos;
  await terminarFlujo(ctx);
  if (!await exigir(ctx, tienda_id, "gestionar_tarifas")) return;
  await guardar(tienda_id, barrio_id, { tarifa: valor, entrega: true });
  await detalleBarrio(ctx, tienda_id, barrio_id, `✅ Tarifa guardada: ${formatearPesos(valor)}`);
}

registrarCallback(P.tarifa, manejarTarifas);
registrarFlujo("tarifa_barrio", flujoTarifa);
