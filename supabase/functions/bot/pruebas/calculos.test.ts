import { assertEquals } from "jsr:@std/assert@1";
import {
  calcularSubtotal,
  calcularTotalPedido,
  formatearPesos,
  numeroPedido,
  parsearPrecio,
} from "../logica/calculos.ts";

Deno.test("subtotal suma precio por cantidad", () => {
  const items = [
    { precio_unitario: 3840, cantidad: 2 },
    { precio_unitario: 6200, cantidad: 1 },
  ];
  assertEquals(calcularSubtotal(items), 13880);
  assertEquals(calcularSubtotal([]), 0);
});

Deno.test("total suma el domicilio", () => {
  assertEquals(calcularTotalPedido(13880, 4000), 17880);
  assertEquals(calcularTotalPedido(13880, 0), 13880);
});

Deno.test("formato de pesos colombianos", () => {
  assertEquals(formatearPesos(17500), "$17.500");
  assertEquals(formatearPesos(412300), "$412.300");
  assertEquals(formatearPesos(1200000), "$1.200.000");
  assertEquals(formatearPesos(500), "$500");
  assertEquals(formatearPesos(0), "$0");
});

Deno.test("número visible del pedido", () => {
  assertEquals(numeroPedido(42), "#0042");
  assertEquals(numeroPedido(7), "#0007");
  assertEquals(numeroPedido(12345), "#12345");
});

Deno.test("precios escritos por el usuario", () => {
  assertEquals(parsearPrecio("4.500"), 4500);
  assertEquals(parsearPrecio("4500"), 4500);
  assertEquals(parsearPrecio("$4.500"), 4500);
  assertEquals(parsearPrecio("4,5"), null);
  assertEquals(parsearPrecio("abc"), null);
});
