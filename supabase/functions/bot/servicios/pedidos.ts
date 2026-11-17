// Acceso a datos de pedidos y llamadas a las funciones SQL atómicas.
import { db } from "../../_compartido/supabase.ts";
import type { EstadoPedido, MedioPago, Modalidad } from "../logica/estados.ts";
import { obtenerTienda, type Tienda } from "./tiendas.ts";

export interface ItemPedido {
  nombre_producto: string;
  precio_unitario: number;
  cantidad: number;
  subtotal: number;
}

export interface Pedido {
  id: number;
  tienda_id: number;
  cliente_telegram_id: number;
  estado: EstadoPedido;
  modalidad: Modalidad;
  barrio_id: number | null;
  direccion: string | null;
  nombre_cliente: string;
  telefono_cliente: string;
  observaciones: string | null;
  medio_pago: MedioPago;
  subtotal: number;
  valor_domicilio: number;
  total: number;
  comprobante_file_id: string | null;
  pago_confirmado: boolean;
  codigo_entrega: string | null;
  intentos_codigo_fallidos: number;
  alerta_codigo_enviada: boolean;
  domiciliario_telegram_id: number | null;
  motivo_cancelacion: string | null;
  detalle_cancelacion: string | null;
  recordatorio_en: string | null;
  recordatorio_enviado: boolean;
  vence_en: string | null;
  es_prueba: boolean;
  creado_en: string;
}

export interface PedidoDetalle extends Pedido {
  items: ItemPedido[];
  tienda: Tienda;
  barrio_nombre: string | null;
}

export async function obtenerPedido(id: number): Promise<PedidoDetalle | null> {
  if (!id) return null;
  const { data } = await db.from("pedidos").select("*, pedido_items(*), barrios(nombre)").eq("id", id).maybeSingle();
  if (!data) return null;
  const tienda = await obtenerTienda(data.tienda_id);
  if (!tienda) return null;
  // deno-lint-ignore no-explicit-any
  const fila = data as any;
  return {
    ...fila,
    items: (fila.pedido_items ?? []).sort((a: { id: number }, b: { id: number }) => a.id - b.id),
    tienda,
    barrio_nombre: fila.barrios?.nombre ?? null,
  } as PedidoDetalle;
}

// "Gana el primero": false si el pedido ya no estaba en los estados esperados
export async function cambiarEstado(
  pedidoId: number,
  esperados: EstadoPedido[],
  nuevo: EstadoPedido,
  actor: number | null,
  // deno-lint-ignore no-explicit-any
  cambios: Record<string, any> = {},
): Promise<boolean> {
  const { data, error } = await db.rpc("cambiar_estado_pedido", {
    p_pedido: pedidoId,
    p_estados_esperados: esperados,
    p_estado_nuevo: nuevo,
    p_actor: actor,
    p_cambios: cambios,
  });
  if (error) throw new Error(`cambiar_estado_pedido: ${error.message}`);
  return data === true;
}

export interface ResultadoCancelacion {
  cancelado: boolean;
  repuestos: number[];
  habia_pago: boolean;
}

export async function cancelarPedido(
  pedidoId: number,
  permitidos: EstadoPedido[],
  motivo: string,
  detalle: string | null,
  actor: number | null,
): Promise<ResultadoCancelacion> {
  const { data, error } = await db.rpc("cancelar_pedido", {
    p_pedido: pedidoId,
    p_estados_permitidos: permitidos,
    p_motivo: motivo,
    p_detalle: detalle,
    p_actor: actor,
  });
  if (error) throw new Error(`cancelar_pedido: ${error.message}`);
  return data as ResultadoCancelacion;
}

export async function pedidosNoFinales(tiendaId: number): Promise<Pedido[]> {
  const { data } = await db.from("pedidos").select("*").eq("tienda_id", tiendaId)
    .not("estado", "in", "(entregado,cancelado)").order("creado_en");
  return (data ?? []) as Pedido[];
}

export async function historialTienda(tiendaId: number, desde: Date): Promise<Pedido[]> {
  const { data } = await db.from("pedidos").select("*").eq("tienda_id", tiendaId)
    .in("estado", ["entregado", "cancelado"]).gte("creado_en", desde.toISOString())
    .order("creado_en", { ascending: false }).limit(20);
  return (data ?? []) as Pedido[];
}

export async function pedidosDeCliente(telegramId: number): Promise<(Pedido & { tienda_nombre: string })[]> {
  const { data } = await db.from("pedidos").select("*, tiendas(nombre)").eq("cliente_telegram_id", telegramId)
    .order("creado_en", { ascending: false }).limit(30);
  // deno-lint-ignore no-explicit-any
  const filas = ((data ?? []) as any[]).map((f) => ({ ...f, tienda_nombre: f.tiendas?.nombre ?? "" }));
  const activos = filas.filter((f) => f.estado !== "entregado" && f.estado !== "cancelado");
  const finales = filas.filter((f) => f.estado === "entregado" || f.estado === "cancelado").slice(0, 5);
  return [...activos, ...finales];
}

export async function pedidosDeDomiciliario(tiendaId: number, telegramId: number): Promise<Pedido[]> {
  const { data } = await db.from("pedidos").select("*").eq("tienda_id", tiendaId)
    .eq("domiciliario_telegram_id", telegramId).in("estado", ["listo", "despachado"]).order("creado_en");
  return (data ?? []) as Pedido[];
}

// El pedido más reciente del cliente que espera comprobante (para tomar la siguiente foto)
export async function pedidoEsperandoPago(telegramId: number): Promise<number | null> {
  const { data } = await db.from("pedidos").select("id").eq("cliente_telegram_id", telegramId)
    .eq("estado", "esperando_pago").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

export interface Domiciliario {
  telegram_id: number;
  nombre: string;
}

export async function domiciliariosActivos(tiendaId: number): Promise<Domiciliario[]> {
  const { data } = await db.from("miembros_tienda").select("telegram_id, usuarios(nombre_telegram, username)")
    .eq("tienda_id", tiendaId).eq("rol", "domiciliario").eq("activo", true);
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((f) => ({
    telegram_id: f.telegram_id,
    nombre: f.usuarios?.nombre_telegram || (f.usuarios?.username ? `@${f.usuarios.username}` : String(f.telegram_id)),
  }));
}

// Pedidos asignados en listo o despachado (RN-40)
export async function tienePedidosAsignados(tiendaId: number, telegramId: number): Promise<boolean> {
  return (await pedidosDeDomiciliario(tiendaId, telegramId)).length > 0;
}
