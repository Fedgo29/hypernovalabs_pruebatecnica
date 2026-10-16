# Checklist de entrega contra el enunciado

## Actualización del 16 de octubre de 2026

- [x] API, portal y PostgreSQL levantados en GCP; acceso privado por túnel SSH y login admin/asistente confirmados por el autor.
- [x] Carga repetida en GCP: 200 compradores, 50 ventas, 150 agotados y cero errores inesperados; captura de la salida compartida. Falta importar el JSON original de esa VM al repositorio.
- [x] Billetera y cámara virtual de otro emulador: lectura con resultado «Entrada válida» observada.
- [x] Rotación a 25 segundos, verificación de límites temporales en 8 pruebas criptográficas y contador actualizado confirmado en Android.
- [x] Configuración EAS APK y documentación de operación publicadas en rama de desarrollo; no equivale a un APK ya generado.
- [x] [Memoria para portafolio](../PORTAFOLIO.md) con alcance, pruebas y limitaciones.
- [ ] Continúan pendientes el video/GIF de dos escáneres offline, validación nativa completa, APK terminado, importación del informe GCP, publicación final en main y visibilidad pública.

Las marcas de la revisión histórica inferior describen el estado del día anterior; esta actualización prevalece para cámara, GCP y duración del QR. Los informes históricos no se reescriben como si fueran pruebas de una revisión posterior.

---

Revisión histórica del 15 de octubre de 2026 (America/Panama). Fuente: enunciado completo aportado en la conversación, su síntesis y dirección técnica. Restricción actual del usuario: demostrar Android solo con emuladores en el PC; no usar teléfonos físicos.

**Cómo leerla:** `[x]` significa realizado en el alcance descrito; `[ ]` significa pendiente o sin evidencia suficiente. «Implementado» no equivale a «probado en Android». La confirmación del usuario acredita arranque Docker en Windows y acceso de demostración; no acredita por sí sola todos los flujos móviles.

## Prioridad para cerrar la entrega

1. [ ] Validar compra y generación de QR en el emulador: confirma criptografía real en el runtime móvil, no solo Node/compilación.
2. [ ] Preparar dos instalaciones Android independientes para los escáneres y una sesión de billetera; seguir la guía de emuladores. No usar cuentas/puertas distintas en una sola instalación como sustituto.
3. [ ] Probar modo avión, cámara virtual, duplicado tras reinicio, QR antiguo, transferencia/revocación y conflicto entre puertas; guardar evidencia.
4. [ ] Resolver o declarar explícitamente las diferencias funcionales detectadas abajo: picos sospechosos de compra, significado de aforo dentro e historial de transferencias.
5. [ ] Incorporar las últimas correcciones y documentación a `main` mediante revisión/merge autorizado, antes de congelar la versión de la grabación.
6. [ ] Grabar el video/GIF del doble ingreso y publicar su enlace. Si se graba el recorrido completo, usar 5–12 minutos.
7. [ ] Comprobar repositorio público, instrucciones desde clon limpio y coincidencia del commit mostrado con el entregado.

## Infraestructura y backend

- [x] Backend NestJS + TypeScript estricto y PostgreSQL; monolito modular.
- [x] Portal web separado y construido en su propio contenedor.
- [x] Compose arranca base, migraciones, semilla, API y portal sin configuración manual de contraseñas.
- [x] Clon limpio probado en nube, con volúmenes nuevos y adaptador de proxy/CA; segunda inicialización no duplica datos ni cambia su ancla.
- [x] Arranque Docker en Windows confirmado por el usuario: API, portal y PostgreSQL saludables; jobs terminan con 0.
- [x] Corrección CRLF publicada: `.gitattributes` y normalización del entrypoint en Docker.
- [x] Dataset real inspeccionado: 8.762 registros; semilla sanitizada, relaciones preservadas y IDs de usuario mapeados por rol.
- [x] `.env.example`, puertos configurables, health y readiness.
- [x] Secretos aleatorios por instalación, sin valores públicos utilizables; job owner separado de API UID 1000/rol SQL limitado.
- [x] REST `/v1`, validación de entrada, errores accionables y logs JSON con correlación.
- [x] Instrucciones Expo y backend local; Android Emulator usa `10.0.2.2`.
- [ ] Confirmar en el Windows final la reproducción completa desde un clon limpio del commit que se entregará, además del arranque ya comprobado.

## Autenticación y reglas de negocio

- [x] Registro de asistente, login, refresh con rotación/replay y logout que revoca realmente; comprobados por API.
- [x] Roles asistente/staff/organizador/admin y ámbito por evento; evento ajeno y staff sin asignación rechazados en integración.
- [x] Rate limiting de autenticación y compras implementado para una API; no se promete coordinación entre réplicas.
- [ ] Añadir/ejecutar evidencia específica de los umbrales de rate limiting; los 18 escenarios actuales no son una prueba dedicada de este control.
- [x] Límite por comprador/evento aplicado concurrentemente entre zonas. Transferir no libera el límite del comprador original.
- [x] Fase vigente al reservar, precio autoritativo e importes enteros; importe manipulado ignorado y precio congelado al pagar comprobados.
- [x] Reserva idempotente, pago único, expiración/recuperación, cancelación y pago tardío reembolsado sin ticket, comprobados.
- [x] Reembolso idempotente devuelve cupo; entrada usada rechazada y carrera ingreso/reembolso probada.
- [x] Transferencia, aceptación, cancelación pendiente y revocación de credencial anterior comprobadas por API/protocolo.
- [x] Autor/motivo y auditoría append-only; rol SQL de aplicación no modifica/borra evidencia.

## Cuatro invariantes

| Invariante | Evidencia disponible | Pendiente |
|---|---|---|
| No sobreventa | 200 compradores HTTP concurrentes, exactamente 50 tickets/cargos, 150 SOLD_OUT, sin negativos ni reservas residuales | Repetir y grabar la ejecución en el Windows final |
| Cobro único | Reintentos concurrentes reserva/pago, conflicto de payload, expiración y pago que cruza vencimiento mientras espera bloqueo | Recorrido de doble toque/respuesta perdida y recuperación en Android |
| Autenticidad y QR rotativo | 7 tests criptográficos Node, pruebas API, bundles Android/iOS y bytecode Hermes compilados | Firma/verificación reales y QR antiguo/revocado en emuladores |
| Ingreso lógico único | Dos dispositivos de protocolo, un ingreso central, dos intentos, incidente y reenvío idempotente comprobados | Dos instalaciones Android offline, SQLite persistente y evidencia visible |

## App asistente

- [x] Implementadas pantallas: registro/login, Eventos, reserva/contador/pago, Billetera, Transferir e Historial; carga/vacío/error y listas virtualizadas.
- [x] Implementados QR por ventana de 15 s, clave del titular con Expo Crypto/SecureStore y caché SQLite.
- [ ] Recorrer registro → reserva → pago → billetera en Android con red.
- [ ] Abrir cada entrada con red y comprobar billetera/QR sin conexión.
- [ ] Comprobar rotación, captura de hace 60 s rechazada y clave emisora ausente del cliente.
- [ ] Probar transferir por correo, aceptar, cancelar y rechazo de la credencial anterior tras sincronizar revocaciones.
- [ ] Probar entradas usadas/reembolsadas no transferibles en la UI/API; no atribuir al test de transferencia aceptada cobertura de todos los estados.
- [ ] Comprobar historial, reembolso, errores y doble toque en el emulador.
- [ ] Revisar claridad de estados: compras e historial consultan la compra; usada/transferida se muestran en la billetera por entrada. No se debe afirmar que una compra completa pasó a esos estados al transferir/usar solo una de sus entradas.

## App staff y modo offline

- [x] Implementados dispositivo, turno por evento/puerta, claves confiables y revocaciones incrementales.
- [x] Implementada verificación offline de firma, vigencia, evento/zona y revocación conocida.
- [x] Implementados UUID por intento, todos los resultados persistidos, rechazo local y lotes idempotentes; sync manual y automática.
- [ ] Cámara virtual y permisos funcionando en Android, con lectura de QR real; verificación manual no sustituye esta prueba.
- [ ] Modo avión con Wi-Fi también apagado, sin auto-sync; pendientes permanecen hasta reconectar.
- [ ] Rechazo local tras cerrar/reabrir la aplicación, con acceso al bundle sin red; reiniciar el desarrollo con Metro inaccesible no demuestra una pérdida de SQLite.
- [ ] Dos escáneres con SQLite separados aceptan offline; al sincronizar aparece incidente y se conservan ambos intentos.
- [ ] Repetir sync sin duplicados y recuperar revocaciones después de transferencia/reembolso/anulación.
- [ ] Medir fluidez y arranque con miles de intentos en SQLite del emulador; los ingresos históricos de PostgreSQL no validan rendimiento móvil.

## Portal administrativo

- [x] Crear/editar eventos, zonas/aforos, fases y puertas; asignar/retirar staff, comprobado en Chromium.
- [x] Ventas, reservadas/disponibles e ingresos desde API real; búsqueda de tickets y reembolso/anulación con motivo.
- [x] Accesos por puerta/hora, dispositivos/última sync, incidentes y auditoría consultados en navegador real.
- [x] Recorrido de 18 pasos y vistas 1440/390 px sin errores JS/consola/API.
- [ ] **Picos sospechosos de compra:** no se encontró detector que genere esos incidentes. Rate limiting no sustituye la alerta requerida. Implementarlo/probarlo o documentarlo como omisión explícita antes de entregar.
- [ ] **Aforo dentro del recinto:** actualmente se muestran ingresos únicos acumulados; no hay modelo de salidas. Definir/documentar ese supuesto o implementar ocupación actual si se exige entradas menos salidas. No presentar el acumulado como conteo físico exacto.
- [ ] Comprobar nativamente incidente de escáner desincronizado/antiguo; el código lo contempla, pero el recorrido de navegador no generó todos los tipos.

## Rendimiento, pruebas y seguridad

- [x] 7 pruebas criptográficas + 5 sesiones web + 18 integración: 30 aprobadas en la evidencia guardada.
- [x] Carga reproducible y métricas reserva/pago; ráfaga adicional de 500 lecturas. Resultados en `docs/qa/load-results.json`.
- [x] Caché pública de disponibilidad de 500 ms, compra autoritativa y explicación de consistencia.
- [x] Índices y EXPLAIN real de cuatro consultas; la más lenta de esa muestra está identificada. No es un máximo probado de todos los endpoints/volúmenes.
- [x] Cursores en listados principales de eventos, entradas, compras, incidentes, dispositivos y auditoría.
- [ ] Revisar transferencias grandes: la API actualmente limita la respuesta a 100 sin cursor, por lo que no debe darse por completa la paginación de todos los listados.
- [x] `npm audit` ejecutado: 0 avisos en producción API/portal al medir.
- [ ] Resolver o evaluar/documentar los 35 avisos del workspace Expo/Metro (23 altos, 12 moderados); no confundir el filtro API/portal con auditoría limpia de todo el monorepo.
- [ ] Guardar resultados actuales de Windows y Android; no reemplazar los informes históricos de nube afirmando que se ejecutaron allí si no se ejecutaron.

## Entregables

- [x] Código subido al repositorio Fedgo29/hypernovalabs_pruebatecnica, rama de desarrollo.
- [x] `main` contiene la entrega base por PR #1, commit remoto `407f96a`, verificado al revisar.
- [ ] Integrar en `main` la corrección Windows `1a84ab6` y esta guía/checklist; no se hizo merge a main sin autorización.
- [ ] Confirmar visibilidad pública abriendo el repositorio en ventana sin sesión; acceso autenticado no prueba que sea público.
- [x] README, arquitectura, decisiones, endpoints, variables, credenciales demo generadas y límites offline documentados.
- [x] Instrucciones móviles exactas para ejecutar; esto satisface la alternativa de instrucciones del enunciado.
- [ ] APK instalable verificado, **preferido, no requisito absoluto si las instrucciones funcionan**.
- [ ] Video corto o GIF de dos escáneres offline con incidente, **entregable obligatorio**.
- [ ] Video recorrido de 5–12 minutos, **bonus destacado**, útil para reunir el resto de evidencias.
- [ ] Enlace del video en la primera sección del README, acceso del evaluador probado y commit mostrado coherente con el entregado.

## Bonus que no bloquean el cierre obligatorio

- [ ] Lista de espera, asientos, Apple/Google Wallet y push.
- [ ] E2E móvil Detox/Maestro, CI GitHub Actions y OpenTelemetry.
- [ ] SSE/WebSocket, despliegue HTTPS GCP/Azure, cola virtual y antibots.

No invertir el tiempo restante en bonus antes de cerrar los cuatro invariantes, la demostración móvil y los entregables. Ver [guía de grabación](guia-video.md) y los informes en `docs/qa/`.
