# Validación del portal en navegador real

El recorrido se ejecutó contra el portal construido en `http://127.0.0.1:8080` y la API PostgreSQL real en `http://127.0.0.1:3000`, con Chromium y Playwright. El resultado registrado es **18 pasos correctos, cero errores JavaScript, cero errores de consola y cero respuestas API fallidas** en el recorrido. Los datos y acciones no se simularon.

Evidencia:

- [Resultado estructurado](admin-smoke.json).
- [Portal de escritorio, 1440 px](admin-smoke.png).
- [Portal móvil, 390 px](admin-mobile-smoke.png).
- Recorrido ejecutable: `apps/admin/tests/browser-smoke.cjs`.

Se verificaron login administrativo, inventario y reportes contra la API, navegación móvil sin desbordamiento y cierre del menú con Escape; creación y edición de evento, zona y aforo, fase de precio entero y puerta; asignación y retiro de staff desde usuarios reales; búsqueda de dos entradas compradas; reembolso y anulación con motivo; auditoría y cierre de sesión con rechazo HTTP 401 del token anterior.

La zona de prueba tuvo capacidad 60. Tras comprar dos entradas de 3000 centésimos y reembolsar una, quedaron una vendida, 59 disponibles e ingresos netos de 3000. Al anular la otra, quedaron cero vendidas, 60 disponibles y los mismos ingresos netos: anular revoca sin generar una devolución monetaria. El evento creado al completar el recorrido quedó cancelado. La validación genera registros de prueba auditables en la base de datos.

Las credenciales se leen en memoria mediante `docker compose exec -T api cat /app/runtime/demo-credentials.json`. No se imprimen ni se incluyen en las capturas o el resultado. La cuenta administrativa proviene del dataset saneado.

Para repetir con Docker Compose saludable, un módulo `playwright-core` instalado como herramienta de desarrollo y Chromium disponible:

```bash
PLAYWRIGHT_MODULE=/ruta/a/playwright-core \
CHROMIUM_PATH=/usr/bin/chromium \
npm run test:browser -w @hypernova/admin
```

`ADMIN_SMOKE_ORIGIN` y `ADMIN_SMOKE_API_URL` permiten cambiar los puertos de portal y backend. El valor de `PLAYWRIGHT_MODULE` puede omitirse si `playwright-core` ya es resoluble por Node. Esta herramienta de navegador no añade dependencias a la aplicación entregada.

Los ensayos iniciales del script necesitaron ajustar selectores de etiquetas con ayuda y esperar los datos asíncronos; no requirieron cambios del código del portal. El resultado adjunto corresponde al recorrido completo exitoso.
