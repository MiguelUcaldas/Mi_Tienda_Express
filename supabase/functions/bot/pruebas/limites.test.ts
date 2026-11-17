import { assertEquals } from "jsr:@std/assert@1";
import { contarProductosParaLimite, puedeCrearProducto } from "../logica/limites.ts";

Deno.test("límite de 10 sin Premium", () => {
  assertEquals(puedeCrearProducto(false, 9, 10), true);
  assertEquals(puedeCrearProducto(false, 10, 10), false);
  assertEquals(puedeCrearProducto(false, 11, 10), false);
});

Deno.test("Premium sin límite", () => {
  assertEquals(puedeCrearProducto(true, 10, 10), true);
  assertEquals(puedeCrearProducto(true, 500, 10), true);
});

Deno.test("los eliminados no cuentan, los inactivos sí", () => {
  const productos = [
    ...Array.from({ length: 9 }, () => ({ eliminado: false })),
    { eliminado: true },
    { eliminado: true },
  ];
  assertEquals(contarProductosParaLimite(productos), 9);
  assertEquals(puedeCrearProducto(false, contarProductosParaLimite(productos), 10), true);
});
