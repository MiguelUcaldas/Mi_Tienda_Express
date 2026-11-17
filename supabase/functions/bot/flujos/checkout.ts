// Hacer pedido (11.5): modalidad, datos guardados, nombre, teléfono, barrio, dirección, observaciones y medio de pago.
import { InlineKeyboard, Keyboard } from "npm:grammy@^1";
import { db } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback, registrarFlujo } from "../enrutador.ts";
import { escaparHtml, normalizarTelefono, nombreMedioPago } from "../logica/formato.ts";
import { DATO_CANCELAR, tecladoBarrios, tecladoCancelar, tecladoComunas } from "../menus/comunes.ts";
import { barriosDeComuna, listarComunas, obtenerBarrio } from "../servicios/barrios.ts";
import { itemsCarrito } from "../servicios/carrito.ts";
import { iniciarFlujo, irAPaso } from "../servicios/conversacion.ts";
import { mediosDe, obtenerTienda, obtenerUsuario, estadoApertura } from "../servicios/tiendas.ts";
import { avisar, banner, mostrar, responder } from "../ui.ts";
import { confirmarPedido, mostrarResumen } from "./checkout_confirmar.ts";

const FLUJO = "checkout";
const d = (...partes: (string | number)[]) => armar(P.checkout, ...partes);

// Validaciones previas, en orden (11.5). Devuelve el mensaje de error o null.
export async function validarAntesDePedir(ctx: MiContexto, tiendaId: number): Promise<string | null> {
  const tienda = await obtenerTienda(tiendaId);
  if (!tienda || !tienda.activa) return "😕 Esta tienda no está recibiendo pedidos por ahora.";
  const apertura = await estadoApertura(tiendaId);
  if (!apertura.abierta) {
    return `🔒 ${escaparHtml(tienda.nombre)} está cerrada.${apertura.textoAbre ? ` Abre ${apertura.textoAbre}.` : ""}\nPuedes seguir armando tu carrito 🛒`;
  }
  const { count } = await db.from("pedidos").select("id", { count: "exact", head: true })
    .eq("tienda_id", tiendaId).eq("cliente_telegram_id", ctx.from!.id).not("estado", "in", "(entregado,cancelado)");
  if ((count ?? 0) > 0) {
    return "⏳ Ya tienes un pedido en curso en esta tienda. Cuando termine podrás hacer otro. Míralo en 🧾 Mis pedidos.";
  }
  if ((await itemsCarrito(tiendaId, ctx.from!.id)).length === 0) return "🛒 Tu carrito está vacío.";
  return null;
}

async function barrioSinEntrega(tiendaId: number, barrioId: number): Promise<boolean> {
  const { data } = await db.from("tarifas_domicilio").select("entrega").eq("tienda_id", tiendaId).eq("barrio_id", barrioId).maybeSingle();
  return data?.entrega === false;
}

async function ofrecerRecogida(ctx: MiContexto, texto: string) {
  await irAPaso(ctx, "no_entrega", { barrio_id: null });
  await mostrar(ctx, texto, new InlineKeyboard().text("🏪 Recoger en tienda", d("mod", "r")).text("❌ Cancelar", DATO_CANCELAR));
}

// Decide qué falta y lo pregunta
export async function siguientePaso(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const tienda = await obtenerTienda(datos.tienda_id);
  if (!tienda) return;

  if (!datos.modalidad) {
    await irAPaso(ctx, "modalidad");
    await mostrar(ctx, "¿Cómo quieres recibir tu pedido?",
      new InlineKeyboard().text("🛵 Domicilio", d("mod", "d")).text("🏪 Recoger en tienda", d("mod", "r")).row().text("❌ Cancelar", DATO_CANCELAR));
    return;
  }
  if (!datos.ofrecidos) {
    const u = await obtenerUsuario(ctx.from!.id);
    const tieneBase = u?.nombre_entrega && u?.telefono;
    const tieneDomicilio = u?.ultimo_barrio_id && u?.ultima_direccion;
    if (tieneBase && (datos.modalidad === "recogida" || tieneDomicilio)) {
      await irAPaso(ctx, "datos_guardados", { ofrecidos: true });
      const barrio = await obtenerBarrio(u!.ultimo_barrio_id);
      const pregunta = datos.modalidad === "domicilio"
        ? `¿Enviamos a ${escaparHtml(u!.ultima_direccion)}, ${escaparHtml(barrio?.nombre)}, a nombre de ${escaparHtml(u!.nombre_entrega)} (${escaparHtml(u!.telefono)})?`
        : `¿El pedido queda a nombre de ${escaparHtml(u!.nombre_entrega)} (${escaparHtml(u!.telefono)})?`;
      await mostrar(ctx, pregunta, new InlineKeyboard().text("✅ Sí", d("dg", "si")).text("✏️ Cambiar datos", d("dg", "no")).row().text("❌ Cancelar", DATO_CANCELAR));
      return;
    }
    datos.ofrecidos = true;
  }
  if (!datos.nombre) {
    await irAPaso(ctx, "nombre", { ofrecidos: true });
    await mostrar(ctx, "👤 ¿A nombre de quién va el pedido? Escribe tu nombre:", tecladoCancelar());
    return;
  }
  if (!datos.telefono) {
    await irAPaso(ctx, "telefono");
    const teclado = new Keyboard().requestContact("📱 Compartir mi número").resized().oneTime();
    await ctx.reply(`${banner(ctx)}📱 Compártenos tu número con el botón de abajo o escríbelo (7 a 13 dígitos).\nPara salir escribe /cancelar.`,
      { parse_mode: "HTML", reply_markup: teclado });
    return;
  }
  if (datos.modalidad === "domicilio" && !datos.barrio_id) {
    await irAPaso(ctx, "comuna");
    const teclado = tecladoComunas(await listarComunas(), (o) => d("com", o))
      .text("🤷 Mi barrio no aparece", d("nobar")).row().text("❌ Cancelar", DATO_CANCELAR);
    await mostrar(ctx, "📍 ¿En qué comuna queda tu barrio?", teclado);
    return;
  }
  if (datos.modalidad === "domicilio" && !datos.direccion) {
    await irAPaso(ctx, "direccion");
    await mostrar(ctx, "🏠 Escribe tu dirección exacta con referencias (ej. «Calle 65 #23-10, casa esquinera, portón verde»):", tecladoCancelar());
    return;
  }
  if (datos.observaciones === undefined) {
    await irAPaso(ctx, "observaciones");
    await mostrar(ctx, "📝 ¿Alguna indicación para la tienda? Escríbela o toca el botón.",
      new InlineKeyboard().text("Sin observaciones", d("obs")).row().text("❌ Cancelar", DATO_CANCELAR));
    return;
  }
  if (!datos.medio_pago) {
    await irAPaso(ctx, "medio_pago");
    const teclado = new InlineKeyboard();
    for (const m of await mediosDe(tienda.id)) {
      const icono = m.tipo === "contra_entrega" ? "💵" : "💳";
      teclado.text(`${icono} ${nombreMedioPago(m.tipo, datos.modalidad)}`, d("mp", m.tipo)).row();
    }
    teclado.text("❌ Cancelar", DATO_CANCELAR);
    await mostrar(ctx, "💳 ¿Cómo vas a pagar?", teclado);
    return;
  }
  await irAPaso(ctx, "resumen");
  await mostrarResumen(ctx);
}

async function elegirBarrio(ctx: MiContexto, barrioId: number) {
  const barrio = await obtenerBarrio(barrioId);
  if (!barrio) return;
  const tienda = await obtenerTienda(ctx.estado.datos.tienda_id);
  if (await barrioSinEntrega(ctx.estado.datos.tienda_id, barrioId)) {
    await ofrecerRecogida(ctx, `😕 ${escaparHtml(tienda?.nombre)} no hace domicilios a ${escaparHtml(barrio.nombre)}. ¿Quieres recogerlo en la tienda?`);
    return;
  }
  ctx.estado.datos.barrio_id = barrioId;
  await siguientePaso(ctx);
}

async function manejarCheckout(ctx: MiContexto, partes: string[]) {
  const accion = partes[1];
  if (accion === "ini") {
    const tiendaId = num(partes, 2);
    const error = await validarAntesDePedir(ctx, tiendaId);
    if (error) {
      await avisar(ctx, "No se puede hacer el pedido todavía");
      await responder(ctx, error, new InlineKeyboard().text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
      return;
    }
    await iniciarFlujo(ctx, FLUJO, "modalidad", { tienda_id: tiendaId });
    await siguientePaso(ctx);
    return;
  }
  if (ctx.estado.flujo !== FLUJO) {
    await avisar(ctx, "Este paso ya venció. Empieza de nuevo desde tu carrito 🛒");
    return;
  }
  const datos = ctx.estado.datos;
  switch (accion) {
    case "mod":
      datos.modalidad = partes[2] === "d" ? "domicilio" : "recogida";
      if (datos.modalidad === "recogida") {
        datos.barrio_id = null;
        datos.direccion = null;
      }
      await siguientePaso(ctx);
      return;
    case "dg":
      if (partes[2] === "si") {
        const u = await obtenerUsuario(ctx.from!.id);
        datos.nombre = u?.nombre_entrega;
        datos.telefono = u?.telefono;
        if (datos.modalidad === "domicilio") {
          datos.direccion = u?.ultima_direccion;
          await elegirBarrio(ctx, u!.ultimo_barrio_id!);
          return;
        }
      }
      await siguientePaso(ctx);
      return;
    case "com":
      await mostrar(ctx, "📍 Elige tu barrio:", tecladoBarrios(await barriosDeComuna(num(partes, 2)), 1, (id) => d("bar", id), (p) => d("bpg", partes[2], p))
        .text("🤷 Mi barrio no aparece", d("nobar")).row().text("⬅️ Comunas", d("coms")).text("❌ Cancelar", DATO_CANCELAR));
      return;
    case "bpg":
      await mostrar(ctx, "📍 Elige tu barrio:", tecladoBarrios(await barriosDeComuna(num(partes, 2)), num(partes, 3), (id) => d("bar", id), (p) => d("bpg", partes[2], p))
        .text("🤷 Mi barrio no aparece", d("nobar")).row().text("⬅️ Comunas", d("coms")).text("❌ Cancelar", DATO_CANCELAR));
      return;
    case "coms":
      datos.barrio_id = null;
      await siguientePaso(ctx);
      return;
    case "bar":
      await elegirBarrio(ctx, num(partes, 2));
      return;
    case "nobar":
      await ofrecerRecogida(ctx, "😕 Por ahora no hacemos domicilios a barrios fuera de la lista. ¿Quieres recogerlo en la tienda?");
      return;
    case "obs":
      datos.observaciones = null;
      await siguientePaso(ctx);
      return;
    case "mp":
      datos.medio_pago = partes[2];
      await siguientePaso(ctx);
      return;
    case "ok":
      await confirmarPedido(ctx);
      return;
  }
}

async function flujoCheckout(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const texto = ctx.message?.text?.trim() ?? "";
  switch (ctx.estado.paso) {
    case "nombre":
      if (texto.length < 2 || texto.length > 60) {
        await responder(ctx, "Escribe un nombre de 2 a 60 caracteres 🙂", tecladoCancelar());
        return;
      }
      datos.nombre = texto;
      await siguientePaso(ctx);
      return;
    case "telefono": {
      const contacto = ctx.message?.contact;
      if (contacto && contacto.user_id !== ctx.from!.id) {
        await ctx.reply("Ese contacto no es tuyo 🤔. Usa el botón «📱 Compartir mi número» o escribe tu número.");
        return;
      }
      const telefono = normalizarTelefono(contacto?.phone_number ?? texto);
      if (!telefono) {
        await ctx.reply("Ese número no parece válido. Escribe entre 7 y 13 dígitos 📱");
        return;
      }
      datos.telefono = telefono;
      await ctx.reply("✅ ¡Gracias!", { reply_markup: { remove_keyboard: true } });
      await siguientePaso(ctx);
      return;
    }
    case "direccion":
      if (texto.length < 5 || texto.length > 200) {
        await responder(ctx, "Escribe la dirección con un poco más de detalle (mínimo 5 caracteres).", tecladoCancelar());
        return;
      }
      datos.direccion = texto;
      await siguientePaso(ctx);
      return;
    case "observaciones":
      if (texto.length > 200) {
        await responder(ctx, "Máximo 200 caracteres, porfa ✂️");
        return;
      }
      datos.observaciones = texto || null;
      await siguientePaso(ctx);
      return;
    default:
      await responder(ctx, "Usa los botones de arriba para continuar 👆, o escribe /cancelar para salir.");
  }
}

registrarCallback(P.checkout, manejarCheckout);
registrarFlujo(FLUJO, flujoCheckout);
