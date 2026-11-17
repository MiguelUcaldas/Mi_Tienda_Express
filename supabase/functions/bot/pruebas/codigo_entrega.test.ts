import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  ALFABETO_INVITACION,
  codigoCorrecto,
  debeAlertarCodigo,
  generarCodigoEntrega,
  generarCodigoInvitacion,
} from "../logica/codigo_entrega.ts";

Deno.test("genera 4 dígitos", () => {
  for (let i = 0; i < 200; i++) assertMatch(generarCodigoEntrega(), /^\d{4}$/);
});

Deno.test("conserva ceros a la izquierda", () => {
  assertEquals(generarCodigoEntrega(() => 0), "0000");
  assertEquals(generarCodigoEntrega(() => 0.00425), "0042");
  assertEquals(generarCodigoEntrega(() => 0.99999), "9999");
});

Deno.test("validación del código", () => {
  assertEquals(codigoCorrecto("4827", "4827"), true);
  assertEquals(codigoCorrecto("4827", " 4827 "), true);
  assertEquals(codigoCorrecto("4827", "4828"), false);
  assertEquals(codigoCorrecto(null, "4827"), false);
});

Deno.test("alerta en el intento 3 y no antes", () => {
  assertEquals(debeAlertarCodigo(1, 3, false), false);
  assertEquals(debeAlertarCodigo(2, 3, false), false);
  assertEquals(debeAlertarCodigo(3, 3, false), true);
  // Solo una vez
  assertEquals(debeAlertarCodigo(4, 3, true), false);
});

Deno.test("código de invitación de 8 caracteres sin O, 0, I ni 1", () => {
  for (let i = 0; i < 100; i++) {
    const codigo = generarCodigoInvitacion();
    assertEquals(codigo.length, 8);
    for (const c of codigo) assertEquals(ALFABETO_INVITACION.includes(c), true);
    assertEquals(/[O0I1]/.test(codigo), false);
  }
});
