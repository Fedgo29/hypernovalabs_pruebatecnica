# Fuentes y matriz de requisitos

## Fuentes y alcance

1. **Solicitud del usuario:** ejecutar las instrucciones de dirección técnica,
   comenzando por la auditoría y continuando por fases verificables.
2. **Dirección técnica:** documento adjunto «DIRECCIÓN TÉCNICA — HYPERNOVA LABS».
   Los tres textos recibidos son idénticos byte a byte; su copia está en
   [direccion-tecnica.md](direccion-tecnica.md). Es la referencia disponible para
   esta matriz, no un sustituto del enunciado.
3. **Dataset:** `datos-prueba-ticketing.json` adjunto. Fue inspeccionado de manera
   independiente; sus filas históricas no definen por sí solas reglas de negocio.
4. **Enunciado: recibido posteriormente en la conversación.** El archivo HTML
   original no está en el checkout. [enunciado.md](enunciado.md) conserva una
   síntesis estructurada del contenido remitido, identificada como síntesis y no
   como transcripción literal. Su recepción resuelve el bloqueo por ausencia de
   requisitos; no se confunde la ausencia del archivo con ausencia de su contenido.

Los criterios R01–R39 proceden de la dirección técnica y se han contrastado con
los puntos del enunciado recogidos en la síntesis. R40–R49 añaden requisitos
explícitos de ese enunciado. Cuando la dirección exige un comportamiento más
concreto, se mantiene esa exigencia: por ejemplo, se elige NestJS aunque el
enunciado permita NestJS o .NET. Esta matriz especifica aceptación; no acredita
implementación ni prueba. Los resultados reales deben enlazarse desde QA.

## Matriz trazable

| ID | Requisito de dirección técnica | Criterio verificable | Componente / evidencia futura |
|---|---|---|---|
| R01 | NestJS, PostgreSQL, TypeScript estricto | API arranca; compila con `strict`; consultas críticas usan PostgreSQL | `apps/api`, integración |
| R02 | React Native + Expo + TypeScript | Cliente asistente y escáner funcionan en un dispositivo o emulador compatible | `apps/mobile`, prueba móvil |
| R03 | Portal administrativo en contenedor independiente | Portal consume la API real y se construye/arranca por separado | `apps/admin`, Compose |
| R04 | Monolito modular y separación de responsabilidades | Módulos con límites explícitos; contratos validados en API | Arquitectura, contratos, pruebas API |
| R05 | No sobreventa | 200 compradores por 50 entradas: exactamente 50 vendidas y ninguna reserva/cantidad inconsistente | PostgreSQL, integración y carga |
| R06 | Reserva temporal → pago simulado → entrada | Transiciones atómicas; pago y ticket trazables a reserva y compra | Reservas, pagos, entradas |
| R07 | Idempotencia de reserva y pago | Reintentos simultáneos producen una operación; misma clave y payload distinto se rechazan | Unicidad SQL, pruebas concurrentes |
| R08 | Expiración persistente y recuperación | Reservas vencidas liberan cupo una vez, también después de reinicio | Worker recuperable, prueba de reinicio |
| R09 | Pago tardío | Política explícita y proceso idempotente; propuesta: reembolso simulado sin ticket | Pagos, ADR, integración |
| R10 | Importes enteros en centésimos | Precio autoritativo y totales enteros; payload manipulado no altera importe | Fases de precio, validación SQL/API |
| R11 | Límite por usuario/evento concurrente | Solicitudes paralelas no superan el límite; semántica del cómputo documentada | Contador transaccional, concurrencia |
| R12 | Credencial auténtica verificable offline | Firma del emisor válida sin red; privada del emisor ausente de móvil | Credenciales, pruebas criptográficas |
| R13 | QR rotativo de posesión | Firma del titular, ventana corta y QR antiguo rechazado; compatibilidad Expo ejecutada | Móvil, spike criptográfico y prueba |
| R14 | Transferencia y revocación | Cambio de titular incrementa versión/revoca credencial; cancelación pendiente funciona | Entradas/transferencias, integración |
| R15 | Rechazo local de doble escaneo | Persistencia sobrevive reinicio; dos intentos del mismo ticket no generan dos aceptaciones locales | SQLite móvil, prueba de reinicio |
| R16 | Registro persistente de cada intento con UUID | Aceptados, rechazados y conflictos permanecen trazables sin borrar historia | Móvil, API de sincronización |
| R17 | Sincronización por lotes idempotente | Repetir lote no duplica intentos ni accesos; mismo UUID con datos distintos se rechaza | Sync, integración/API |
| R18 | Revocaciones incrementales | Cursor recuperable; transferencia/anulación/reembolso aparecen en delta; recuperación ante cursor antiguo | Sync, pruebas delta |
| R19 | Dos puertas offline | Dos admisiones se conservan; un acceso lógico central y un incidente auditable | Accesos, incidentes, prueba dos clientes |
| R20 | Registro, login y logout | Contraseña protegida; logout revoca sesión; entradas validadas | Identidad, pruebas API |
| R21 | Refresh con rotación/revocación real | Token previo no sirve tras rotar; reutilización y logout revocan lo correspondiente | Sesiones SQL, integración |
| R22 | Asistente, staff, organizador y admin | Permisos por rol y recurso; organizador no modifica evento ajeno | Autorización, prueba negativa API |
| R23 | Rate limiting autenticación/compras | Solicitudes sobre umbral reciben rechazo; política explícita de reinicio/réplicas | API, pruebas de límites |
| R24 | Reembolso dentro de plazo, nunca usado, con devolución de cupo | Usada/reembolso tardío rechazados; carrera ingreso/reembolso serializada; cupo recuperado una sola vez | Reembolsos/accesos, integración |
| R25 | Autor, motivo y auditoría protegida | Anulación/reembolso registran actor/motivo; rol app no altera ni borra auditoría | SQL permisos, pruebas seguridad |
| R26 | Eventos, zonas, aforos, puertas y fases | CRUD autorizado; aforo no baja de compromisos; fases temporalmente coherentes | Portal/API, pruebas API |
| R27 | Staff y control de acceso | Asignaciones por evento/puerta; dispositivo autorizado solo en su ámbito | Portal, staff, dispositivos |
| R28 | Ventas/disponibilidad/ingresos/reembolsos | Datos consultados a API y reconciliables con PostgreSQL | Portal, consultas verificadas |
| R29 | Búsqueda de entradas | Búsqueda paginada y autorizada; evita fuga entre organizadores | Portal/API, prueba por recurso |
| R30 | Dispositivos, última sync, incidentes y auditoría | Portal consulta estados reales y conserva conflicto de offline | Portal/API, pruebas de flujo |
| R31 | Compose con inicialización automática | Clon limpio + `docker compose up`: DB, migraciones, semillas, API y portal listos | Infra, prueba de clon limpio |
| R32 | Semillas idempotentes y dataset inspeccionado | Ejecutar dos veces no duplica; datos sensibles no se publican; inventario reconciliado | Importador, integración |
| R33 | `.env.example`, healthchecks/readiness | Sin secretos reales; readiness falla cuando DB/migraciones no están listas | Infra, pruebas de arranque |
| R34 | Acceso Expo al backend | Instrucciones verificadas para dispositivo/emulador; host y TLS coherentes | README, prueba móvil |
| R35 | Unitarias, integración, API y concurrencia | Escenarios obligatorios ejecutados; distinguir fallos/skips/no ejecutados | `tests`, evidencia QA |
| R36 | Carga reproducible e índices | p50/p95 de reserva y pago, errores y ventas de ejecución real; EXPLAIN de la consulta más costosa y justificación de índices | Carga y plan SQL guardados |
| R37 | Arquitectura, ADR, QA, progreso, seguridad | Documentos mantienen implementado/probado/pendiente/bloqueado | `docs`, revisión documental |
| R38 | Cambios seguros, commits pequeños, sin push/merge a main | Rama de desarrollo, estado inicial preservado y revisiones locales | Git, bitácora |
| R39 | Límite de cuatro días | Plan prioriza invariantes y obligatorios; no implica una fecha de entrega inventada | Bitácora y alcance contrastado |
| R40 | Cartelera, contador, billetera e historial del asistente | Pantallas consumen API real; contador refleja estado/tiempo pertinente; historial y credenciales se muestran al titular autorizado | Móvil, prueba funcional |
| R41 | Estados de carga, vacío y error | Cada consulta relevante muestra carga, ausencia de datos y fallos con recuperación; no aparenta éxito si falla la API | Móvil/portal, prueba funcional |
| R42 | Turno de staff por puerta y validación evento/zona | Staff inicia turno autorizado; escaneo fuera de evento o zona se rechaza y queda registrado | Móvil/API, prueba de alcance |
| R43 | Sincronización automática y manual | Ambos disparadores usan lotes idempotentes; fallo conserva cola local; recuperación reintenta sin duplicar | Móvil/API, prueba sin conexión |
| R44 | Endpoints monetarios idempotentes | Toda mutación de dinero usa clave y huella de petición; reservas/pagos/reembolsos repetidos conservan resultado sin duplicar efecto | API/PostgreSQL, concurrencia |
| R45 | Logs JSON con correlación | Solicitudes y operaciones emiten JSON válido y correlation ID propagado; no contienen tokens, contraseñas ni claves | API, evidencia de logs saneados |
| R46 | REST versionada, health y readiness | Contratos bajo v1; liveness y readiness distinguen proceso vivo de servicio listo y dependencias disponibles | API/infra, prueba arranque/fallo DB |
| R47 | Cursor para listados grandes | Paginación estable por cursor; límites validados; sin duplicados/omisiones bajo el criterio documentado de consistencia | API, integración |
| R48 | Disponibilidad bajo alto tráfico y consistencia explicada | Se documentan autoridad, actualización y posibles desfases de lectura; reservas mantienen I aunque la cifra pública cambie | API/arquitectura, carga |
| R49 | Dataset original como semilla automática, secretos solo por entorno | Importación parte del adjunto auditado; adaptación/saneamiento documentados, repetición no duplica; secretos requeridos no tienen defaults utilizables | Seed/Compose, auditoría y prueba arranque |

## Criterios transversales y bonus

- Los diez escenarios obligatorios de calidad están cubiertos por R05, R07,
  R08, R13, R14, R19, R24, R22, R10 y R17 respectivamente. Ejecutarlos y registrar
  comandos, resultados y límites es parte de R35.
- Los bonus son opcionales y no desplazan los cuatro invariantes ni los flujos
  obligatorios. No se presupone una lista de bonus que no esté reproducida aquí.
- La tabla de evaluación del enunciado suma **120**. Se conserva ese total;
  no se inventa una normalización a 100 ni pesos individuales no reproducidos
  en esta síntesis.

## Parámetros y decisiones que deben quedar explícitos

- Duración de reserva y QR, tolerancia de reloj, expiración de sesión y política
  de dispositivos: documentar los valores concretos y su procedencia.
- Límite por usuario/evento: indicar comprador o titular y tratamiento de
  reservas, usadas, reembolsadas y transferidas; probar posibles elusiones.
- Reembolso: plazo concreto, recuperación transaccional de cupo y resolución
  de carreras con ingresos o sincronizaciones offline.
- Transferencia: requisitos de recepción, cancelación de pendientes, momento
  del cambio de titular y aparición de revocaciones incrementales.
- Históricos del dataset: adaptación e inconsistencias documentadas sin
  convertir ejemplos en nuevas reglas ni publicar datos sensibles.
- Plataformas y bibliotecas móviles: versiones y compatibilidad criptográfica
  demostradas mediante ejecución real, además de la compilación TypeScript.

Estos puntos requieren decisiones trazables y validación, no una nueva fuente
inventada. Su estado se mantiene en ADR y QA; recibir el enunciado no los da
por implementados.
