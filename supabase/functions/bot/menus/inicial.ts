// Menú inicial (11.1), búsqueda y recomendación de tiendas, "Mis tiendas" y entrada a una tienda.
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { escaparHtml } from "../logica/formato.ts";
import { NOMBRES_ROL } from "../logica/permisos.ts";
import { rolDe } from "../middleware/rol.ts";
import { fijarTiendaActiva, iniciarFlujo, terminarFlujo } from "../servicios/conversacion.ts";
import {
  buscarTiendas,
  estadoApertura,
  misTiendas,
  obtenerTienda,
  type Tienda,
  tiendasRecomendadas,
  tieneMembresias,
} from "../servicios/tiendas.ts";
import { avisar, mostrar, responder } from "../ui.ts";
import { tecladoCancelar } from "./comunes.ts";
import { mostrarMenuCliente } from "./cliente.ts";
import { mostrarMenuPersonal } from "./personal.ts";

export async function mostrarMenuInicial(ctx: MiContexto, nuevo = false) {
  const nombre = escaparHtml(ctx.from?.first_name ?? "");
  const teclado = new InlineKeyboard()
    .text("🔍 Buscar tienda", armar(P.menu, "bt")).text("⭐ Recomiéndame tiendas", armar(P.menu, "rec")).row()
    .text("🧾 Mis pedidos", armar(P.pedidoCliente, "l")).row();
  if (await tieneMembresias(ctx.from!.id)) teclado.text("🏪 Mis tiendas", armar(P.menu, "mt")).row();
  teclado.text("➕ Registrar mi tienda", armar(P.registro, "ini")).row();
  if (ctx.esSuperAdmin) teclado.text("👑 Panel Super Admin", armar(P.superAdmin, "p")).row();
  if (ctx.modoPruebas) teclado.text("🧪 Salir del modo pruebas", armar(P.modoPruebas, "salir")).row();

  const texto = `👋 ¡Hola, ${nombre}! Bienvenido a Mi Tienda Express.\n¿Qué quieres hacer?`;
  if (nuevo) await responder(ctx, texto, teclado);
  else await mostrar(ctx, texto, teclado);
}

// Entra a una tienda y muestra el menú según el rol que tenga ahí
export async function entrarTienda(ctx: MiContexto, tiendaId: number, nuevo = false) {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda) {
    await avisar(ctx, "No encontré esa tienda 🤔");
    return;
  }
  await fijarTiendaActiva(ctx, tienda.id);
  const rol = await rolDe(ctx, tienda.id);
  if (rol === "cliente") {
    if (!tienda.activa && !ctx.esSuperAdmin) {
      await mostrar(ctx, `😕 ${escaparHtml(tienda.nombre)} no está disponible por ahora.`,
        new InlineKeyboard().text("⬅️ Menú inicial", armar(P.menu, "ini")));
      return;
    }
    await mostrarMenuCliente(ctx, tienda, nuevo);
  } else {
    await mostrarMenuPersonal(ctx, tienda, rol, nuevo);
  }
}

// Después de /cancelar o "❌ Cancelar": vuelve al menú de la tienda activa o al inicial
export async function volverAlMenu(ctx: MiContexto, nuevo = false) {
  if (ctx.estado.tienda_activa_id) await entrarTienda(ctx, ctx.estado.tienda_activa_id, nuevo);
  else await mostrarMenuInicial(ctx, nuevo);
}

async function listaDeTiendas(ctx: MiContexto, tiendas: Tienda[], titulo: string, destacadas: boolean) {
  const lineas: string[] = [titulo, ""];
  const teclado = new InlineKeyboard();
  for (const t of tiendas) {
    const apertura = await estadoApertura(t.id);
    lineas.push(`${destacadas ? "⭐ Destacada · " : ""}<b>${escaparHtml(t.nombre)}</b> · ${apertura.abierta ? "🟢 Abierta" : "🔴 Cerrada"}`);
    if (t.descripcion) lineas.push(escaparHtml(t.descripcion));
    lineas.push("");
    teclado.text(`Entrar a ${t.nombre}`, armar(P.menu, "t", t.id)).row();
  }
  teclado.text("⬅️ Menú inicial", armar(P.menu, "ini"));
  await mostrar(ctx, lineas.join("\n").trim(), teclado);
}

async function manejarMenu(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  switch (accion) {
    case "nada":
      return;
    case "ini":
      await terminarFlujo(ctx);
      await fijarTiendaActiva(ctx, null);
      await mostrarMenuInicial(ctx);
      return;
    case "cx":
      await terminarFlujo(ctx);
      await avisar(ctx, "Listo, cancelado 👍");
      await volverAlMenu(ctx);
      return;
    case "t":
      await terminarFlujo(ctx);
      await entrarTienda(ctx, parseInt(partes[2], 10));
      return;
    case "bt":
      await iniciarFlujo(ctx, "buscar_tienda", "texto");
      await mostrar(ctx, "🔍 Escribe el nombre de la tienda que buscas:", tecladoCancelar());
      return;
    case "rec": {
      const tiendas = await tiendasRecomendadas();
      if (tiendas.length === 0) {
        await mostrar(ctx, "Aún no hay tiendas destacadas. Busca tu tienda por nombre 🔍",
          new InlineKeyboard().text("🔍 Buscar tienda", armar(P.menu, "bt")).row().text("⬅️ Menú inicial", armar(P.menu, "ini")));
        return;
      }
      await listaDeTiendas(ctx, tiendas, "⭐ <b>Tiendas recomendadas</b>", true);
      return;
    }
    case "mt": {
      const lista = await misTiendas(ctx.from!.id);
      const teclado = new InlineKeyboard();
      for (const { tienda, rol } of lista) {
        teclado.text(`${tienda.nombre} · ${NOMBRES_ROL[rol]}`, armar(P.menu, "t", tienda.id)).row();
      }
      teclado.text("⬅️ Menú inicial", armar(P.menu, "ini"));
      await mostrar(ctx, lista.length ? "🏪 <b>Mis tiendas</b>\nElige una:" : "Aún no haces parte de ninguna tienda.", teclado);
      return;
    }
  }
}

async function flujoBuscarTienda(ctx: MiContexto) {
  const texto = ctx.message?.text?.trim();
  if (!texto) {
    await responder(ctx, "Escríbeme el nombre de la tienda 🙂", tecladoCancelar());
    return;
  }
  await terminarFlujo(ctx);
  const tiendas = await buscarTiendas(texto);
  if (tiendas.length === 0) {
    await responder(ctx, `No encontré tiendas con «${escaparHtml(texto)}». Prueba con otra palabra.`,
      new InlineKeyboard().text("🔍 Buscar otra vez", armar(P.menu, "bt")).row().text("⬅️ Menú inicial", armar(P.menu, "ini")));
    return;
  }
  await listaDeTiendas(ctx, tiendas, `🔍 Resultados para «${escaparHtml(texto)}»`, false);
}

registrarCallback(P.menu, manejarMenu);
registrarFlujo("buscar_tienda", flujoBuscarTienda);
