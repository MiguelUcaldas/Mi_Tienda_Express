// Carrito por cliente y por tienda (RN-17 a RN-20). No aparta stock.
import { db } from "../../_compartido/supabase.ts";
import { conPrecios, type Producto, type ProductoConPrecio } from "./catalogo.ts";

export interface ItemCarrito {
  producto: ProductoConPrecio;
  cantidad: number;
}

async function idCarrito(tiendaId: number, telegramId: number, crear: boolean): Promise<number | null> {
  const { data } = await db.from("carritos").select("id").eq("tienda_id", tiendaId).eq("telegram_id", telegramId).maybeSingle();
  if (data) return data.id;
  if (!crear) return null;
  const { data: nuevo, error } = await db.from("carritos")
    .upsert({ tienda_id: tiendaId, telegram_id: telegramId }, { onConflict: "tienda_id,telegram_id" })
    .select("id").single();
  if (error) throw new Error(`No se pudo crear el carrito: ${error.message}`);
  return nuevo.id;
}

async function tocar(carritoId: number) {
  await db.from("carritos").update({ actualizado_en: new Date().toISOString() }).eq("id", carritoId);
}

// Devuelve los ítems vigentes; quita los de productos ocultos o eliminados
export async function itemsCarrito(tiendaId: number, telegramId: number): Promise<ItemCarrito[]> {
  const id = await idCarrito(tiendaId, telegramId, false);
  if (!id) return [];
  const { data } = await db.from("carrito_items").select("cantidad, productos(*)").eq("carrito_id", id);
  // deno-lint-ignore no-explicit-any
  const filas = (data ?? []) as any[];
  const vigentes = filas.filter((f) => f.productos && f.productos.activo && !f.productos.eliminado);
  const sobrantes = filas.filter((f) => !vigentes.includes(f)).map((f) => f.productos?.id).filter(Boolean);
  if (sobrantes.length) await db.from("carrito_items").delete().eq("carrito_id", id).in("producto_id", sobrantes);

  const productos = await conPrecios(vigentes.map((f) => f.productos as Producto), tiendaId);
  return vigentes
    .map((f, i) => ({ producto: productos[i], cantidad: f.cantidad as number }))
    .sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre));
}

export async function contarUnidades(tiendaId: number, telegramId: number): Promise<number> {
  const id = await idCarrito(tiendaId, telegramId, false);
  if (!id) return 0;
  const { data } = await db.from("carrito_items").select("cantidad").eq("carrito_id", id);
  return (data ?? []).reduce((s, f) => s + (f.cantidad as number), 0);
}

// Fija la cantidad exacta (0 = quitar). Nunca supera el stock.
export async function fijarCantidad(tiendaId: number, telegramId: number, producto: Producto, cantidad: number): Promise<number> {
  const id = await idCarrito(tiendaId, telegramId, cantidad > 0);
  if (!id) return 0;
  const final = Math.min(Math.max(0, cantidad), producto.stock);
  if (final === 0) {
    await db.from("carrito_items").delete().eq("carrito_id", id).eq("producto_id", producto.id);
  } else {
    await db.from("carrito_items").upsert({ carrito_id: id, producto_id: producto.id, cantidad: final }, { onConflict: "carrito_id,producto_id" });
  }
  await tocar(id);
  return final;
}

export async function cantidadEnCarrito(tiendaId: number, telegramId: number, productoId: number): Promise<number> {
  const id = await idCarrito(tiendaId, telegramId, false);
  if (!id) return 0;
  const { data } = await db.from("carrito_items").select("cantidad").eq("carrito_id", id).eq("producto_id", productoId).maybeSingle();
  return data?.cantidad ?? 0;
}

// Suma al carrito sin pasar del stock. Devuelve la cantidad final y si se limitó.
export async function agregarAlCarrito(tiendaId: number, telegramId: number, producto: Producto, cantidad: number) {
  const actual = await cantidadEnCarrito(tiendaId, telegramId, producto.id);
  const deseada = actual + cantidad;
  const final = await fijarCantidad(tiendaId, telegramId, producto, deseada);
  return { final, limitado: final < deseada };
}

export async function vaciarCarrito(tiendaId: number, telegramId: number) {
  await db.from("carritos").delete().eq("tienda_id", tiendaId).eq("telegram_id", telegramId);
}
