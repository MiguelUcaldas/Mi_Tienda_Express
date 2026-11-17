// Menú del cliente dentro de una tienda (11.2) e "Info de la tienda".
import { InlineKeyboard } from "npm:grammy@^1";
import type { MiContexto } from "../contexto.ts";
import { armar, num, P } from "../datos_callback.ts";
import { registrarCallback } from "../enrutador.ts";
import { escaparHtml, nombreMedioPago } from "../logica/formato.ts";
import { textoHorarioSemana } from "../logica/horarios.ts";
import { obtenerBarrio } from "../servicios/barrios.ts";
import { contarUnidades } from "../servicios/carrito.ts";
import { enlaceBot } from "../servicios/telegram.ts";
import { estadoApertura, horariosDe, mediosDe, obtenerTienda, type Tienda } from "../servicios/tiendas.ts";
import { mostrar, responder } from "../ui.ts";

export async function mostrarMenuCliente(ctx: MiContexto, tienda: Tienda, nuevo = false) {
  const apertura = await estadoApertura(tienda.id);
  const unidades = await contarUnidades(tienda.id, ctx.from!.id);
  const texto = [
    `🏪 <b>${escaparHtml(tienda.nombre)}</b> · ${apertura.texto}`,
    tienda.descripcion ? escaparHtml(tienda.descripcion) : "",
  ].filter(Boolean).join("\n");
  const teclado = new InlineKeyboard()
    .text("📂 Categorías", armar(P.categoria, "l", tienda.id)).text("🔍 Buscar producto", armar("bp", tienda.id)).row()
    .text("🔥 Ofertas", armar(P.ofertas, tienda.id, 1))
    .text(unidades > 0 ? `🛒 Mi carrito (${unidades})` : "🛒 Mi carrito", armar(P.carrito, "v", tienda.id)).row()
    .text("ℹ️ Info de la tienda", armar("inf", tienda.id)).text("🧾 Mis pedidos", armar(P.pedidoCliente, "l")).row()
    .text("⬅️ Cambiar de tienda", armar(P.menu, "ini"));
  if (nuevo) await responder(ctx, texto, teclado);
  else await mostrar(ctx, texto, teclado);
}

function lineaMedio(tipo: string): string {
  return tipo === "contra_entrega" ? "Contra entrega / Pagar al recoger" : nombreMedioPago(tipo);
}

async function mostrarInfo(ctx: MiContexto, partes: string[]) {
  const tienda = await obtenerTienda(num(partes, 1));
  if (!tienda) return;
  const [barrio, horarios, medios, apertura] = await Promise.all([
    obtenerBarrio(tienda.barrio_id),
    horariosDe(tienda.id),
    mediosDe(tienda.id),
    estadoApertura(tienda.id),
  ]);
  const texto = [
    `ℹ️ <b>${escaparHtml(tienda.nombre)}</b> · ${apertura.texto}`,
    tienda.descripcion ? escaparHtml(tienda.descripcion) : "",
    "",
    `📍 ${escaparHtml(tienda.direccion)}${barrio ? `, ${escaparHtml(barrio.nombre)}` : ""}`,
    tienda.telefono_contacto ? `📱 ${escaparHtml(tienda.telefono_contacto)}` : "",
    "",
    "🕒 <b>Horario</b>",
    textoHorarioSemana(horarios),
    "",
    "💳 <b>Medios de pago</b>",
    medios.map((m) => `• ${lineaMedio(m.tipo)}`).join("\n"),
    "",
    `🔗 Comparte la tienda: ${enlaceBot(`t_${tienda.slug}`)}`,
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
  await mostrar(ctx, texto, new InlineKeyboard().text("⬅️ Volver", armar(P.menu, "t", tienda.id)));
}

registrarCallback("inf", mostrarInfo);

// Muestra el enlace de la tienda (botón "🔗 Enlace de la tienda" del personal)
export async function mostrarEnlace(ctx: MiContexto, tienda: Tienda) {
  await responder(ctx, `🔗 Comparte este enlace con tus clientes:\n${enlaceBot(`t_${tienda.slug}`)}`);
}
