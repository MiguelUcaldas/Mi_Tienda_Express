// Resumen y confirmación del pedido (11.5, pasos 6 y 7).
import { InlineKeyboard } from "npm:grammy@^1";
import { db, leerErrorSql } from "../../_compartido/supabase.ts";
import type { MiContexto } from "../contexto.ts";
import { armar, P } from "../datos_callback.ts";
import { formatearPesos, numeroPedido } from "../logica/calculos.ts";
import { escaparHtml, nombreMedioPago } from "../logica/formato.ts";
import { DATO_CANCELAR } from "../menus/comunes.ts";
import { enPruebasEn } from "../middleware/rol.ts";
import { notificarPedidoNuevo } from "../servicios/avisos_pedido.ts";
import { obtenerBarrio } from "../servicios/barrios.ts";
import { fijarCantidad, itemsCarrito } from "../servicios/carrito.ts";
import { obtenerProducto } from "../servicios/catalogo.ts";
import { terminarFlujo } from "../servicios/conversacion.ts";
import { preguntarReabastecimiento } from "../servicios/inventario.ts";
import { obtenerPedido } from "../servicios/pedidos.ts";
import { obtenerTienda } from "../servicios/tiendas.ts";
import { avisar, mostrar } from "../ui.ts";
import { lineasItems, subtotalItems } from "./carrito.ts";
import { validarAntesDePedir } from "./checkout.ts";

export async function mostrarResumen(ctx: MiContexto, aviso = "") {
  const datos = ctx.estado.datos;
  const [tienda, items, barrio] = await Promise.all([
    obtenerTienda(datos.tienda_id),
    itemsCarrito(datos.tienda_id, ctx.from!.id),
    obtenerBarrio(datos.barrio_id),
  ]);
  if (items.length === 0) {
    await terminarFlujo(ctx);
    await mostrar(ctx, `${aviso}\n🛒 Tu carrito quedó vacío.`.trim(),
      new InlineKeyboard().text("⬅️ Volver a la tienda", armar(P.menu, "t", datos.tienda_id)));
    return;
  }
  const lineas = [
    aviso,
    `🧾 <b>Resumen de tu pedido en ${escaparHtml(tienda?.nombre)}</b>`,
    ...lineasItems(items),
    `Subtotal: <b>${formatearPesos(subtotalItems(items))}</b>`,
    datos.modalidad === "domicilio"
      ? `🛵 Domicilio a ${escaparHtml(barrio?.nombre)}: la tienda te dirá el valor al aceptar`
      : "🏪 Recoges en la tienda",
    `👤 ${escaparHtml(datos.nombre)} · 📱 ${escaparHtml(datos.telefono)}`,
    datos.modalidad === "domicilio" ? `🏠 ${escaparHtml(datos.direccion)}` : "",
    `💳 Pago: ${nombreMedioPago(datos.medio_pago, datos.modalidad)}`,
    datos.observaciones ? `📝 "${escaparHtml(datos.observaciones)}"` : "",
    "⚠️ OJO: solo puedes cancelar mientras la tienda no haya empezado a preparar tu pedido.",
  ].filter(Boolean);
  await mostrar(ctx, lineas.join("\n"),
    new InlineKeyboard().text("✅ Confirmar pedido", armar(P.checkout, "ok")).text("❌ Cancelar", DATO_CANCELAR));
}

export async function confirmarPedido(ctx: MiContexto) {
  const datos = ctx.estado.datos;
  const tiendaId = datos.tienda_id as number;
  const error = await validarAntesDePedir(ctx, tiendaId);
  if (error) {
    await terminarFlujo(ctx);
    await mostrar(ctx, error, new InlineKeyboard().text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }

  // Guardar los datos para el próximo pedido (RN-43)
  // deno-lint-ignore no-explicit-any
  const datosUsuario: Record<string, any> = { nombre_entrega: datos.nombre, telefono: datos.telefono, actualizado_en: new Date().toISOString() };
  if (datos.modalidad === "domicilio") {
    datosUsuario.ultimo_barrio_id = datos.barrio_id;
    datosUsuario.ultima_direccion = datos.direccion;
  }
  await db.from("usuarios").update(datosUsuario).eq("telegram_id", ctx.from!.id);

  const { data, error: errorSql } = await db.rpc("crear_pedido", {
    p_cliente: ctx.from!.id,
    p_tienda: tiendaId,
    p_modalidad: datos.modalidad,
    p_barrio_id: datos.barrio_id ?? null,
    p_direccion: datos.direccion ?? null,
    p_nombre: datos.nombre,
    p_telefono: datos.telefono,
    p_observaciones: datos.observaciones ?? null,
    p_medio_pago: datos.medio_pago,
    p_es_prueba: enPruebasEn(ctx, tiendaId),
  });

  if (errorSql) {
    const { codigo, dato } = leerErrorSql(errorSql);
    if (codigo === "STOCK_INSUFICIENTE" || codigo === "PRODUCTO_NO_DISPONIBLE") {
      const producto = await obtenerProducto(parseInt(dato ?? "0", 10));
      if (producto) {
        const disponible = producto.activo && !producto.eliminado ? producto.stock : 0;
        await fijarCantidad(tiendaId, ctx.from!.id, producto, disponible);
        await avisar(ctx, "Ajustamos tu carrito");
        await mostrarResumen(ctx, `⚠️ Lo sentimos, de ${escaparHtml(producto.nombre)} solo quedan ${disponible}. Ajustamos tu carrito.\n`);
        return;
      }
    }
    const mensajes: Record<string, string> = {
      PEDIDO_ACTIVO_EXISTE: "⏳ Ya tienes un pedido en curso en esta tienda.",
      CARRITO_VACIO: "🛒 Tu carrito está vacío.",
      TIENDA_INACTIVA: "😕 Esta tienda no está recibiendo pedidos por ahora.",
      MEDIO_PAGO_INVALIDO: "😕 Ese medio de pago ya no está disponible. Empieza de nuevo, porfa.",
    };
    console.error("crear_pedido:", errorSql.message);
    await terminarFlujo(ctx);
    await mostrar(ctx, mensajes[codigo] ?? "😕 No pudimos crear tu pedido. Intenta de nuevo con /menu",
      new InlineKeyboard().text("⬅️ Volver", armar(P.menu, "t", tiendaId)));
    return;
  }

  await terminarFlujo(ctx);
  const resultado = data as { pedido_id: number; agotados: number[] };
  const tienda = await obtenerTienda(tiendaId);
  await mostrar(ctx,
    `📝 ¡Listo! Tu pedido <b>${numeroPedido(resultado.pedido_id)}</b> fue enviado a ${escaparHtml(tienda?.nombre)}. Te avisaremos cuando lo acepten.`,
    new InlineKeyboard().text("🧾 Mis pedidos", armar(P.pedidoCliente, "l")).text("⬅️ Menú", armar(P.menu, "t", tiendaId)));

  const pedido = await obtenerPedido(resultado.pedido_id);
  if (pedido) await notificarPedidoNuevo(pedido);
  for (const productoId of resultado.agotados ?? []) await preguntarReabastecimiento(productoId);
}
