// Lectura y validación de las variables de entorno de las funciones.

export interface Entorno {
  tokenBot: string;
  secretoWebhook: string;
  superAdminId: string;
  supabaseUrl: string;
}

const REQUERIDAS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "SUPER_ADMIN_TELEGRAM_ID"];

function leerVariable(nombre: string): string {
  const valor = Deno.env.get(nombre)?.trim();
  if (!valor) {
    throw new Error(`Falta la variable ${nombre}. Revisa el archivo .env y ejecuta ./desplegar.sh`);
  }
  return valor;
}

export function leerEntorno(): Entorno {
  for (const nombre of REQUERIDAS) leerVariable(nombre);
  return {
    tokenBot: leerVariable("TELEGRAM_BOT_TOKEN"),
    secretoWebhook: leerVariable("TELEGRAM_WEBHOOK_SECRET"),
    superAdminId: leerVariable("SUPER_ADMIN_TELEGRAM_ID"),
    supabaseUrl: leerVariable("SUPABASE_URL").replace(/\/+$/, ""),
  };
}

export const entorno: Entorno = leerEntorno();

// Comparación en tiempo constante para los secretos de los encabezados
export function secretosIguales(recibido: string | null, esperado: string): boolean {
  if (recibido === null) return false;
  const a = new TextEncoder().encode(recibido);
  const b = new TextEncoder().encode(esperado);
  let diferencia = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) {
    diferencia |= (a[i % (a.length || 1)] ?? 0) ^ b[i];
  }
  return diferencia === 0;
}
