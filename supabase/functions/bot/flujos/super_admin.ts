// Panel Super Admin (11.16): tiendas, Premium, activar/desactivar, cambiar dueño y resumen global.
import { InlineKeyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { formatearPesos } from "../logica/calculos.ts";
import { escaparHtml, paginar } from "../logica/formato.ts";
import { inicioPeriodo } from "../logica/horarios.ts";
import { NOMBRES_ROL } from "../logica/permisos.ts";
import { agregarPaginacion, TAMANO_PAGINA } from "../menus/comunes.ts";
import { esSuperAdmin } from "../middleware/rol.ts";
import { crearInvitacion, miembro, miembrosActivos, quitarMiembro, transferirTienda } from "../servicios/equipo.ts";
import { enlaceBot, enviarTexto } from "../servicios/telegram.ts";
import { duenoDe, nombreVisible, obtenerTienda, obtenerUsuario, type Tienda } from "../servicios/tiendas.ts";
import { avisar, mostrar } from "../ui.ts";

const d = (...partes: (string | number)[]) => armar(P.superAdmin, ...partes);
const FILTROS: Record<string, string> = { a: "Todas", p: "⭐ Premium", d: "🚫 Desactivadas" };

async function panel(ctx: MiContexto) {
  await mostrar(ctx, "👑 <b>Panel Super Admin</b>", new InlineKeyboard()
    .text("🏪 Tiendas", d("t", "a", 1)).text("📊 Resumen global", d("rg")).row()
    .text("🧪 Modo pruebas", armar(P.modoPruebas, "t", 1)).row()
    .text("⬅️ Menú inicial", armar(P.menu, "ini")));
}

async function listarTiendas(ctx: MiContexto, filtro: string, pagina: number) {
  let consulta = db.from("tiendas").select("*");
  if (filtro === "p") consulta = consulta.eq("es_premium", true);
  if (filtro === "d") consulta = consulta.eq("activa", false);
  const { data } = await consulta.order("nombre");
  const pag = paginar((data ?? []) as Tienda[], pagina, TAMANO_PAGINA);
  const teclado = new InlineKeyboard();
  for (const [clave, nombre] of Object.entries(FILTROS)) teclado.text(`${clave === filtro ? "• " : ""}${nombre}`, d("t", clave, 1));
  teclado.row();
  for (const t of pag.items) {
    teclado.text(`${t.es_premium ? "⭐ " : ""}${t.activa ? "" : "🚫 "}${t.nombre}`, d("v", t.id)).row();
  }
  agregarPaginacion(teclado, pag, (p) => d("t", filtro, p));
  teclado.text("⬅️ Panel", d("p"));
  await mostrar(ctx, `🏪 <b>Tiendas</b> · ${FILTROS[filtro]}${pag.items.length ? "" : "\nNo hay tiendas con este filtro."}`, teclado);
}

async function detalleTienda(ctx: MiContexto, tiendaId: number, aviso = "") {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda) return;
  const duenoId = await duenoDe(tiendaId);
  const [dueno, { data: productos }, { count: pedidosMes }] = await Promise.all([
    duenoId ? obtenerUsuario(duenoId) : Promise.resolve(null),
    db.rpc("contar_productos_limite", { p_tienda: tiendaId }),
    db.from("pedidos").select("id", { count: "exact", head: true }).eq("tienda_id", tiendaId)
      .gte("creado_en", inicioPeriodo("mes", new Date()).toISOString()),
  ]);
  await mostrar(ctx, [
    aviso,
    `🏪 <b>${escaparHtml(tienda.nombre)}</b> (${escaparHtml(tienda.slug)})`,
    escaparHtml(tienda.descripcion),
    `📍 ${escaparHtml(tienda.direccion)} · 📱 ${escaparHtml(tienda.telefono_contacto)}`,
    `👑 Dueño: ${duenoId ? escaparHtml(nombreVisible(dueno)) : "sin dueño"}`,
    `📦 Productos: ${productos ?? 0} · 🧾 Pedidos del mes: ${pedidosMes ?? 0}`,
    `⭐ Premium: ${tienda.es_premium ? "sí" : "no"} · Activa: ${tienda.activa ? "sí" : "no"}`,
  ].filter(Boolean).join("\n"), new InlineKeyboard()
    .text(tienda.es_premium ? "Quitar Premium" : "⭐ Activar Premium", d("pr", tiendaId))
    .text(tienda.activa ? "🚫 Desactivar tienda" : "✅ Activar tienda", d("ac", tiendaId)).row()
    .text("✏️ Editar datos", armar(P.miTienda, "menu", tiendaId)).text("👑 Cambiar dueño", d("cd", tiendaId)).row()
    .text("⬅️ Tiendas", d("t", "a", 1)));
}

async function alternarPremium(ctx: MiContexto, tiendaId: number) {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda) return;
  const nuevo = !tienda.es_premium;
  await db.from("tiendas").update({ es_premium: nuevo }).eq("id", tiendaId);
  const duenoId = await duenoDe(tiendaId);
  if (duenoId) {
    await enviarTexto(duenoId, nuevo
      ? `⭐ ¡Tu tienda <b>${escaparHtml(tienda.nombre)}</b> ahora es Premium! Productos ilimitados y apareces en las recomendaciones.`
      : `Tu tienda <b>${escaparHtml(tienda.nombre)}</b> volvió al plan gratuito.`);
  }
  await detalleTienda(ctx, tiendaId, nuevo ? "⭐ Premium activado." : "Premium desactivado.");
}

async function alternarActiva(ctx: MiContexto, tiendaId: number) {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda) return;
  await db.from("tiendas").update({ activa: !tienda.activa }).eq("id", tiendaId);
  await detalleTienda(ctx, tiendaId, tienda.activa ? "🚫 Tienda desactivada." : "✅ Tienda activada.");
}

async function opcionesCambioDueno(ctx: MiContexto, tiendaId: number) {
  await mostrar(ctx, "👑 ¿Cómo quieres cambiar el dueño?", new InlineKeyboard()
    .text("Elegir entre los miembros", d("cdm", tiendaId)).row()
    .text("🔗 Generar enlace de dueño", d("cdl", tiendaId)).row()
    .text("⬅️ Volver", d("v", tiendaId)));
}

async function elegirMiembro(ctx: MiContexto, tiendaId: number) {
  const candidatos = (await miembrosActivos(tiendaId)).filter((m) => m.rol !== "dueno");
  const teclado = new InlineKeyboard();
  for (const m of candidatos) teclado.text(`${m.nombre} · ${NOMBRES_ROL[m.rol]}`, d("cdc", tiendaId, m.telegram_id)).row();
  teclado.text("⬅️ Volver", d("cd", tiendaId));
  await mostrar(ctx, candidatos.length ? "👑 Elige al nuevo dueño:" : "Esta tienda no tiene otros miembros. Usa el enlace de dueño.", teclado);
}

async function cambiarDueno(ctx: MiContexto, tiendaId: number, nuevo: number) {
  if (!await miembro(tiendaId, nuevo)) return void await avisar(ctx, "Esa persona ya no está en el equipo.", true);
  const { anterior, error } = await transferirTienda(tiendaId, nuevo);
  if (error) return void await avisar(ctx, "😕 No se pudo cambiar el dueño.", true);
  const tienda = await obtenerTienda(tiendaId);
  const nombre = escaparHtml(tienda?.nombre);
  await enviarTexto(nuevo, `👑 ¡Ahora eres el dueño de <b>${nombre}</b>!`);
  if (anterior && esSuperAdmin(anterior)) {
    await mostrar(ctx, `✅ Listo, cambiaste el dueño de ${nombre}. Tú quedaste como administrador. ¿Qué prefieres?`, new InlineKeyboard()
      .text("Dejarme como administrador", d("qa", tiendaId)).text("Quitarme de la tienda", d("qd", tiendaId)));
    return;
  }
  if (anterior) await enviarTexto(anterior, `👑 ${nombre} tiene nuevo dueño. Ahora eres administrador.`);
  await detalleTienda(ctx, tiendaId, "✅ Dueño actualizado.");
}

async function resumenGlobal(ctx: MiContexto) {
  const { data, error } = await db.rpc("resumen_global");
  if (error || !data) return void await mostrar(ctx, "😕 No pudimos generar el resumen.");
  // deno-lint-ignore no-explicit-any
  const r = data as any;
  const lineas = [
    "📊 <b>Resumen global</b>",
    `🏪 Tiendas: ${r.tiendas} (⭐ ${r.premium} Premium · ✅ ${r.activas} activas)`,
    "",
    `Hoy: ${r.hoy.pedidos} pedidos · ${formatearPesos(r.hoy.ventas)}`,
    `7 días: ${r.semana.pedidos} pedidos · ${formatearPesos(r.semana.ventas)}`,
    `Este mes: ${r.mes.pedidos} pedidos · ${formatearPesos(r.mes.ventas)}`,
    "",
    "🏆 Top tiendas del mes:",
    // deno-lint-ignore no-explicit-any
    ...(r.top_tiendas.length ? r.top_tiendas.map((t: any, i: number) => ` ${i + 1}. ${escaparHtml(t.nombre)} — ${formatearPesos(t.ventas)}`) : [" Aún no hay ventas."]),
  ];
  await mostrar(ctx, lineas.join("\n"), new InlineKeyboard().text("⬅️ Panel", d("p")));
}

async function manejarSuperAdmin(ctx: MiContexto, partes: string[]) {
  if (!ctx.esSuperAdmin) return void await avisar(ctx, "⛔ Solo para el Super Admin.");
  const id = num(partes, 2);
  switch (partes[1]) {
    case "p": return await panel(ctx);
    case "t": return await listarTiendas(ctx, partes[2] in FILTROS ? partes[2] : "a", num(partes, 3));
    case "v": return await detalleTienda(ctx, id);
    case "pr": return await alternarPremium(ctx, id);
    case "ac": return await alternarActiva(ctx, id);
    case "cd": return await opcionesCambioDueno(ctx, id);
    case "cdm": return await elegirMiembro(ctx, id);
    case "cdc": {
      const m = await miembro(id, num(partes, 3));
      if (!m) return void await avisar(ctx, "Esa persona ya no está en el equipo.", true);
      return void await mostrar(ctx, `⚠️ ¿Seguro? <b>${escaparHtml(m.nombre)}</b> será el nuevo dueño y el dueño actual quedará como administrador.`,
        new InlineKeyboard().text("✅ Sí, cambiar", d("cdok", id, m.telegram_id)).text("❌ No", d("v", id)));
    }
    case "cdok": return await cambiarDueno(ctx, id, num(partes, 3));
    case "cdl": {
      const codigo = await crearInvitacion(id, "dueno", ctx.from!.id);
      return void await mostrar(ctx, `🔗 Enlace de dueño (vale 24 horas, un solo uso):\n${enlaceBot(`inv_${codigo}`)}\n\nQuien lo acepte será el nuevo dueño; el actual pasará a administrador.`,
        new InlineKeyboard().text("⬅️ Volver", d("v", id)));
    }
    case "qa": return void await mostrar(ctx, "👍 Listo, sigues como administrador.");
    case "qd":
      await quitarMiembro(id, ctx.from!.id);
      return void await mostrar(ctx, "✅ Listo, ya no haces parte de esa tienda.", new InlineKeyboard().text("⬅️ Panel", d("p")));
    case "rg": return await resumenGlobal(ctx);
  }
}

registrarCallback(P.superAdmin, manejarSuperAdmin);
