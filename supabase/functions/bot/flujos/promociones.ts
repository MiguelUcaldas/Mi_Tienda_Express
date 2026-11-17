// "🏷️ Promociones" (11.14), RN-13 a RN-16.
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { formatearPesos, parsearEntero, parsearPrecio } from "../logica/calculos.ts";
import { escaparHtml, paginar } from "../logica/formato.ts";
import { fechaHoyBogota, formatearFechaLarga, parsearFechaDDMMAAAA, sumarDiasISO } from "../logica/horarios.ts";
import { aplicarPromocion, type Promocion, promocionVigente, type TipoPromocion, validarValorPromocion } from "../logica/promociones.ts";
import { agregarPaginacion, DATO_CANCELAR, TAMANO_PAGINA, tecladoCancelar } from "../menus/comunes.ts";
import { exigir } from "../middleware/rol.ts";
import { obtenerProducto, productosDeTienda } from "../servicios/catalogo.ts";
import { iniciarFlujo, irAPaso, terminarFlujo } from "../servicios/conversacion.ts";
import { avisar, mostrar, responder } from "../ui.ts";

const FLUJO = "promocion";
const d = (...partes: (string | number)[]) => armar(P.promocion, ...partes);

function describir(promo: Promocion, precio: number): string {
  const valor = promo.tipo === "porcentaje" ? `‑${promo.valor}%` : `precio especial ${formatearPesos(promo.valor)}`;
  return `${valor} → ${formatearPesos(aplicarPromocion(precio, promo))} (del ${formatearFechaLarga(promo.inicia_en)} al ${formatearFechaLarga(promo.termina_en)})`;
}

async function vigentesYProgramadas(filtro: { tienda_id?: number; producto_id?: number }) {
  let consulta = db.from("promociones").select("*, productos(nombre, precio)").eq("activa", true).gte("termina_en", fechaHoyBogota());
  if (filtro.tienda_id) consulta = consulta.eq("tienda_id", filtro.tienda_id);
  if (filtro.producto_id) consulta = consulta.eq("producto_id", filtro.producto_id);
  const { data } = await consulta.order("inicia_en");
  // deno-lint-ignore no-explicit-any
  return (data ?? []) as any[];
}

async function menu(ctx: MiContexto, tiendaId: number) {
  await mostrar(ctx, "🏷️ <b>Promociones</b>", new InlineKeyboard()
    .text("➕ Nueva promoción", d("n", tiendaId, 1)).text("📋 Vigentes y programadas", d("l", tiendaId)).row()
    .text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
}

async function elegirProducto(ctx: MiContexto, tiendaId: number, pagina: number) {
  const pag = paginar(await productosDeTienda(tiendaId), pagina, TAMANO_PAGINA);
  const teclado = new InlineKeyboard();
  for (const p of pag.items) teclado.text(`${p.nombre} — ${formatearPesos(p.precio)}`, d("p", p.id)).row();
  agregarPaginacion(teclado, pag, (n) => d("n", tiendaId, n));
  teclado.text("⬅️ Volver", d("menu", tiendaId));
  await mostrar(ctx, "🏷️ ¿A qué producto le haces la promoción?", teclado);
}

async function empezar(ctx: MiContexto, productoId: number, reemplazar: boolean) {
  const p = await obtenerProducto(productoId);
  if (!p) return;
  if (!reemplazar) {
    const existentes = await vigentesYProgramadas({ producto_id: p.id });
    if (existentes.length) {
      await mostrar(ctx, `Este producto ya tiene una promoción:\n${describir(existentes[0], p.precio)}\n¿Reemplazarla?`,
        new InlineKeyboard().text("Sí, reemplazar", d("rep", p.id)).text("No", d("menu", p.tienda_id)));
      return;
    }
  }
  await iniciarFlujo(ctx, FLUJO, "tipo", { producto_id: p.id, tienda_id: p.tienda_id, precio: p.precio, nombre: p.nombre, reemplazar });
  await mostrar(ctx, `🏷️ <b>${escaparHtml(p.nombre)}</b> (${formatearPesos(p.precio)})\n¿Qué tipo de promoción?`,
    new InlineKeyboard().text("% Descuento", d("t", "porcentaje")).text("💲 Precio especial", d("t", "precio_especial")).row()
      .text("❌ Cancelar", DATO_CANCELAR));
}

async function preguntarFin(ctx: MiContexto) {
  await irAPaso(ctx, "fin");
  await mostrar(ctx, `📅 Empieza el ${formatearFechaLarga(ctx.estado.datos.inicia_en)}. ¿Hasta cuándo?`, new InlineKeyboard()
    .text("En 7 días", d("f", 7)).text("En 15 días", d("f", 15)).text("En 30 días", d("f", 30)).row()
    .text("Otra fecha", d("f", "otra")).text("❌ Cancelar", DATO_CANCELAR));
}

async function mostrarResumen(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  await irAPaso(ctx, "resumen");
  const promo: Promocion = { tipo: datos.tipo, valor: datos.valor, inicia_en: datos.inicia_en, termina_en: datos.termina_en, activa: true };
  await mostrar(ctx, [
    "🧾 <b>Nueva promoción</b>",
    `Producto: ${escaparHtml(datos.nombre)}`,
    `Antes: <s>${formatearPesos(datos.precio)}</s> → Ahora: <b>${formatearPesos(aplicarPromocion(datos.precio, promo))}</b> 🔥`,
    `Del ${formatearFechaLarga(datos.inicia_en)} al ${formatearFechaLarga(datos.termina_en)}`,
    datos.reemplazar ? "⚠️ Reemplaza la promoción que tenía." : "",
  ].filter(Boolean).join("\n"), new InlineKeyboard().text("✅ Guardar", d("ok")).text("❌ Cancelar", DATO_CANCELAR));
}

async function guardar(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  if (datos.reemplazar) {
    await db.from("promociones").update({ activa: false })
      .eq("producto_id", datos.producto_id).eq("activa", true).gte("termina_en", fechaHoyBogota());
  }
  const { error } = await db.from("promociones").insert({
    tienda_id: datos.tienda_id,
    producto_id: datos.producto_id,
    tipo: datos.tipo,
    valor: datos.valor,
    inicia_en: datos.inicia_en,
    termina_en: datos.termina_en,
  });
  await terminarFlujo(ctx);
  if (error) return void await mostrar(ctx, "😕 No pudimos guardar la promoción. Intenta de nuevo.");
  await mostrar(ctx, "✅ ¡Promoción guardada! 🔥", new InlineKeyboard().text("🏷️ Promociones", d("menu", datos.tienda_id)));
}

async function listar(ctx: MiContexto, tiendaId: number) {
  const promos = await vigentesYProgramadas({ tienda_id: tiendaId });
  const hoy = fechaHoyBogota();
  const lineas = ["📋 <b>Promociones vigentes y programadas</b>", ""];
  const teclado = new InlineKeyboard();
  for (const pr of promos) {
    lineas.push(`${promocionVigente(pr, hoy) ? "🔥" : "🗓️"} <b>${escaparHtml(pr.productos?.nombre)}</b>: ${describir(pr, pr.productos?.precio ?? 0)}`);
    teclado.text(`⏹️ Finalizar ${pr.productos?.nombre ?? ""}`, d("fin", pr.id)).row();
  }
  if (!promos.length) lineas.push("No hay promociones activas.");
  teclado.text("⬅️ Volver", d("menu", tiendaId));
  await mostrar(ctx, lineas.join("\n"), teclado);
}

async function manejarPromociones(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  // Pasos dentro del flujo
  if (["t", "i", "f", "ok"].includes(accion)) {
    if (ctx.estado.flujo !== FLUJO) return void await avisar(ctx, "Este paso ya venció.");
    const datos = ctx.estado.datos;
    if (!await exigir(ctx, datos.tienda_id, "gestionar_promociones")) return;
    if (accion === "t") {
      await irAPaso(ctx, "valor", { tipo: partes[2] as TipoPromocion });
      return void await mostrar(ctx, partes[2] === "porcentaje"
        ? "% ¿Qué porcentaje de descuento? (1 a 90)"
        : `💲 ¿Cuál es el precio especial? (menor a ${formatearPesos(datos.precio)})`, tecladoCancelar());
    }
    if (accion === "i") {
      if (partes[2] === "otra") {
        await irAPaso(ctx, "inicio_fecha");
        return void await mostrar(ctx, "📅 Escribe la fecha de inicio (DD/MM/AAAA):", tecladoCancelar());
      }
      datos.inicia_en = partes[2] === "man" ? sumarDiasISO(fechaHoyBogota(), 1) : fechaHoyBogota();
      return await preguntarFin(ctx);
    }
    if (accion === "f") {
      if (partes[2] === "otra") {
        await irAPaso(ctx, "fin_fecha");
        return void await mostrar(ctx, "📅 Escribe la fecha de fin (DD/MM/AAAA):", tecladoCancelar());
      }
      datos.termina_en = sumarDiasISO(datos.inicia_en, num(partes, 2));
      return await mostrarResumen(ctx);
    }
    return await guardar(ctx);
  }

  const esProducto = accion === "p" || accion === "rep";
  const esPromo = accion === "fin";
  let tiendaId = num(partes, 2);
  if (esProducto) tiendaId = (await obtenerProducto(num(partes, 2)))?.tienda_id ?? 0;
  if (esPromo) {
    const { data } = await db.from("promociones").select("tienda_id").eq("id", num(partes, 2)).maybeSingle();
    tiendaId = data?.tienda_id ?? 0;
  }
  if (!tiendaId || !await exigir(ctx, tiendaId, "gestionar_promociones")) return;
  switch (accion) {
    case "menu": return await menu(ctx, tiendaId);
    case "n": return await elegirProducto(ctx, tiendaId, num(partes, 3));
    case "p": return await empezar(ctx, num(partes, 2), false);
    case "rep": return await empezar(ctx, num(partes, 2), true);
    case "l": return await listar(ctx, tiendaId);
    case "fin":
      await db.from("promociones").update({ activa: false }).eq("id", num(partes, 2));
      await avisar(ctx, "⏹️ Promoción finalizada");
      return await listar(ctx, tiendaId);
  }
}

async function flujoPromocion(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim() ?? "";
  const datos = ctx.estado.datos;
  const hoy = fechaHoyBogota();
  switch (ctx.estado.paso) {
    case "valor": {
      const valor = datos.tipo === "porcentaje" ? parsearEntero(texto.replace("%", "")) : parsearPrecio(texto);
      const error = valor === null ? "Escribe solo el número." : validarValorPromocion(datos.tipo, valor, datos.precio);
      if (error) return void await responder(ctx, `🤔 ${error}`, tecladoCancelar());
      await irAPaso(ctx, "inicio", { valor });
      return void await responder(ctx, "📅 ¿Cuándo empieza?", new InlineKeyboard()
        .text("Hoy", d("i", "hoy")).text("Mañana", d("i", "man")).text("Otra fecha", d("i", "otra")).row().text("❌ Cancelar", DATO_CANCELAR));
    }
    case "inicio_fecha": {
      const fecha = parsearFechaDDMMAAAA(texto);
      if (!fecha || fecha < hoy) return void await responder(ctx, "Escribe una fecha válida desde hoy, en formato DD/MM/AAAA.", tecladoCancelar());
      datos.inicia_en = fecha;
      return await preguntarFin(ctx);
    }
    case "fin_fecha": {
      const fecha = parsearFechaDDMMAAAA(texto);
      if (!fecha || fecha < datos.inicia_en) return void await responder(ctx, "La fecha de fin debe ser igual o posterior al inicio (DD/MM/AAAA).", tecladoCancelar());
      datos.termina_en = fecha;
      return await mostrarResumen(ctx);
    }
    default:
      await responder(ctx, "Usa los botones de arriba para continuar 👆, o escribe /cancelar para salir.");
  }
}

registrarCallback(P.promocion, manejarPromociones);
registrarFlujo(FLUJO, flujoPromocion);
