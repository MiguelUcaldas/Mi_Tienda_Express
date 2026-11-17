// Productos, categorías visibles y precios vigentes.
import { db } from "../../_compartido/supabase.ts";
import { fechaHoyBogota } from "../logica/horarios.ts";
import { precioVigente, type Promocion } from "../logica/promociones.ts";

export interface Producto {
  id: number;
  tienda_id: number;
  categoria_id: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  unidad: string;
  stock: number;
  foto_file_id: string | null;
  activo: boolean;
  eliminado: boolean;
  fecha_reabastecimiento: string | null;
}

export interface ProductoConPrecio extends Producto {
  precioFinal: number;
  promocion: Promocion | null;
}

export interface Categoria {
  id: number;
  tienda_id: number | null;
  nombre: string;
  activa: boolean;
}

export async function obtenerProducto(id: number): Promise<Producto | null> {
  if (!id) return null;
  const { data } = await db.from("productos").select("*").eq("id", id).maybeSingle();
  return (data as Producto) ?? null;
}

export async function promocionesVigentes(tiendaId: number): Promise<Promocion[]> {
  const hoy = fechaHoyBogota();
  const { data } = await db.from("promociones").select("*")
    .eq("tienda_id", tiendaId).eq("activa", true)
    .lte("inicia_en", hoy).gte("termina_en", hoy)
    .order("creado_en", { ascending: false });
  return (data ?? []) as Promocion[];
}

export async function conPrecios(productos: Producto[], tiendaId: number): Promise<ProductoConPrecio[]> {
  const promos = await promocionesVigentes(tiendaId);
  const hoy = fechaHoyBogota();
  return productos.map((p) => {
    const calculo = precioVigente(p.precio, promos.filter((x) => x.producto_id === p.id), hoy);
    return { ...p, precioFinal: calculo.precio, promocion: calculo.promocion };
  });
}

export async function productoConPrecio(id: number): Promise<ProductoConPrecio | null> {
  const p = await obtenerProducto(id);
  if (!p) return null;
  return (await conPrecios([p], p.tienda_id))[0];
}

export async function productosVisibles(tiendaId: number, categoriaId?: number): Promise<ProductoConPrecio[]> {
  let consulta = db.from("productos").select("*").eq("tienda_id", tiendaId).eq("activo", true).eq("eliminado", false);
  if (categoriaId) consulta = consulta.eq("categoria_id", categoriaId);
  const { data } = await consulta.order("nombre");
  return await conPrecios((data ?? []) as Producto[], tiendaId);
}

// Todos los no eliminados (activos e inactivos), para el personal
export async function productosDeTienda(tiendaId: number): Promise<Producto[]> {
  const { data } = await db.from("productos").select("*").eq("tienda_id", tiendaId).eq("eliminado", false).order("nombre");
  return (data ?? []) as Producto[];
}

// Comunes no ocultas + propias activas (para elegir al crear productos)
export async function categoriasDeTienda(tiendaId: number): Promise<Categoria[]> {
  const [{ data: cats }, { data: ocultas }] = await Promise.all([
    db.from("categorias").select("*").or(`tienda_id.is.null,tienda_id.eq.${tiendaId}`).order("nombre"),
    db.from("categorias_ocultas").select("categoria_id").eq("tienda_id", tiendaId),
  ]);
  const idsOcultas = new Set((ocultas ?? []).map((o) => o.categoria_id));
  return ((cats ?? []) as Categoria[]).filter((c) =>
    c.tienda_id === null ? !idsOcultas.has(c.id) : c.activa
  );
}

// Categorías visibles para el cliente, con al menos un producto visible
export async function categoriasConProductos(tiendaId: number): Promise<{ categoria: Categoria; cantidad: number }[]> {
  const [categorias, productos] = await Promise.all([categoriasDeTienda(tiendaId), productosVisibles(tiendaId)]);
  return categorias
    .map((categoria) => ({ categoria, cantidad: productos.filter((p) => p.categoria_id === categoria.id).length }))
    .filter((c) => c.cantidad > 0);
}

export async function buscarProductos(tiendaId: number, texto: string): Promise<ProductoConPrecio[]> {
  const { data } = await db.rpc("buscar_productos", { p_tienda: tiendaId, p_texto: texto });
  return await conPrecios((data ?? []) as Producto[], tiendaId);
}

export async function productosEnOferta(tiendaId: number): Promise<ProductoConPrecio[]> {
  return (await productosVisibles(tiendaId)).filter((p) => p.promocion !== null);
}

export async function obtenerCategoria(id: number): Promise<Categoria | null> {
  const { data } = await db.from("categorias").select("*").eq("id", id).maybeSingle();
  return (data as Categoria) ?? null;
}
