// Valores de la tabla configuracion (editables sin redesplegar).
import { db } from "../../_compartido/supabase.ts";

export const VALORES_POR_DEFECTO = {
  minutos_recordatorio_tienda: 3,
  minutos_cancelacion_tienda: 5,
  minutos_recordatorio_cliente: 3,
  minutos_cancelacion_cliente: 5,
  minutos_recordatorio_pago: 5,
  minutos_cancelacion_pago: 10,
  horas_vencimiento_carrito: 24,
  limite_productos_gratis: 10,
  max_pedidos_activos_por_tienda: 1,
  umbral_stock_bajo: 3,
  horas_vencimiento_invitacion: 24,
  intentos_maximos_codigo_entrega: 3,
};

export type Configuracion = typeof VALORES_POR_DEFECTO;

export async function leerConfiguracion(): Promise<Configuracion> {
  const { data } = await db.from("configuracion").select("clave, valor");
  const resultado: Configuracion = { ...VALORES_POR_DEFECTO };
  for (const fila of data ?? []) {
    const valor = parseInt(fila.valor, 10);
    if (fila.clave in resultado && !Number.isNaN(valor)) {
      resultado[fila.clave as keyof Configuracion] = valor;
    }
  }
  return resultado;
}

// Fecha ISO dentro de N minutos (para recordatorio_en y vence_en)
export function enMinutos(minutos: number): string {
  return new Date(Date.now() + minutos * 60_000).toISOString();
}
