import { assertEquals } from "jsr:@std/assert@1";
import {
  CANCELABLES_CLIENTE,
  CANCELABLES_TIENDA,
  clientePuedeCancelar,
  type EstadoPedido,
  type MedioPago,
  type Modalidad,
  tiendaPuedeCancelar,
  transicionPermitida,
} from "../logica/estados.ts";

type Paso = [EstadoPedido, EstadoPedido];

function recorrer(pasos: Paso[], modalidad: Modalidad, medio: MedioPago) {
  for (const [desde, hacia] of pasos) {
    assertEquals(transicionPermitida(desde, hacia, modalidad, medio), true, `${desde} → ${hacia} (${modalidad}, ${medio})`);
  }
}

Deno.test("domicilio con contra entrega", () => {
  recorrer([
    ["esperando_tienda", "esperando_confirmacion_cliente"],
    ["esperando_confirmacion_cliente", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["listo", "despachado"],
    ["despachado", "entregado"],
  ], "domicilio", "contra_entrega");
  assertEquals(transicionPermitida("esperando_confirmacion_cliente", "esperando_pago", "domicilio", "contra_entrega"), false);
});

Deno.test("domicilio con transferencia", () => {
  recorrer([
    ["esperando_tienda", "esperando_confirmacion_cliente"],
    ["esperando_confirmacion_cliente", "esperando_pago"],
    ["esperando_pago", "verificando_pago"],
    ["verificando_pago", "esperando_pago"],
    ["verificando_pago", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["listo", "despachado"],
    ["despachado", "entregado"],
  ], "domicilio", "nequi");
  assertEquals(transicionPermitida("esperando_confirmacion_cliente", "en_preparacion", "domicilio", "nequi"), false);
});

Deno.test("recogida con pago al recoger", () => {
  recorrer([
    ["esperando_tienda", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["listo", "entregado"],
  ], "recogida", "contra_entrega");
  assertEquals(transicionPermitida("listo", "despachado", "recogida", "contra_entrega"), false);
  assertEquals(transicionPermitida("esperando_tienda", "esperando_confirmacion_cliente", "recogida", "contra_entrega"), false);
});

Deno.test("recogida con transferencia", () => {
  recorrer([
    ["esperando_tienda", "esperando_pago"],
    ["esperando_pago", "verificando_pago"],
    ["verificando_pago", "en_preparacion"],
    ["en_preparacion", "listo"],
    ["listo", "entregado"],
  ], "recogida", "bancolombia");
  assertEquals(transicionPermitida("esperando_tienda", "en_preparacion", "recogida", "bancolombia"), false);
});

Deno.test("transiciones inválidas", () => {
  assertEquals(transicionPermitida("entregado", "en_preparacion", "domicilio", "nequi"), false);
  assertEquals(transicionPermitida("esperando_tienda", "despachado", "domicilio", "nequi"), false);
  assertEquals(transicionPermitida("listo", "entregado", "domicilio", "contra_entrega"), false);
  assertEquals(transicionPermitida("cancelado", "esperando_tienda", "recogida", "contra_entrega"), false);
  assertEquals(transicionPermitida("despachado", "cancelado", "domicilio", "contra_entrega"), false);
  assertEquals(transicionPermitida("entregado", "cancelado", "domicilio", "contra_entrega"), false);
});

Deno.test("cancelación del cliente (RN-29)", () => {
  assertEquals(CANCELABLES_CLIENTE.length, 4);
  for (const e of ["esperando_tienda", "esperando_confirmacion_cliente", "esperando_pago", "verificando_pago"] as EstadoPedido[]) {
    assertEquals(clientePuedeCancelar(e), true, e);
  }
  for (const e of ["en_preparacion", "listo", "despachado", "entregado", "cancelado"] as EstadoPedido[]) {
    assertEquals(clientePuedeCancelar(e), false, e);
  }
});

Deno.test("cancelación de la tienda (RN-30)", () => {
  assertEquals(CANCELABLES_TIENDA.length, 5);
  for (const e of ["esperando_confirmacion_cliente", "esperando_pago", "verificando_pago", "en_preparacion", "listo"] as EstadoPedido[]) {
    assertEquals(tiendaPuedeCancelar(e), true, e);
  }
  for (const e of ["esperando_tienda", "despachado", "entregado", "cancelado"] as EstadoPedido[]) {
    assertEquals(tiendaPuedeCancelar(e), false, e);
  }
});
