# Auditoría del dataset de ticketing — Fase 1

Estado: **original analizado; semilla sanitizada generada y comprobada**. Se leyó el adjunto JSON completo y se ejecutó el script de auditoría. El original permanece fuera del repositorio. El enunciado fue recibido después de la inspección inicial y su trazabilidad se registra en [../requirements/enunciado.md](../requirements/enunciado.md). Esta evidencia cubre archivos estáticos; la carga real en PostgreSQL y las garantías del software necesitan validación separada.

## Evidencia y reproducción

El adjunto analizado mide **2.019.134 bytes**. Su SHA-256 es:

```text
1682050bd01edf48bd269151885d0b5872b3fd1c903b5e0d7e2f6a8c3f0d34b9
```

Desde la raíz del repositorio, con Python 3 y su biblioteca estándar:

```bash
python3 scripts/audit-dataset.py /ruta/externa/datos-prueba-ticketing.json > /tmp/dataset-audit.json
```

La ruta debe apuntar a un archivo externo al checkout. El script solo lee bytes y produce JSON agregado en stdout. No requiere acceso a red, credenciales ni dependencias de aplicación. Los códigos de salida son `0` sin defectos confirmados, `1` si existe algún defecto confirmado y `2` para entrada ilegible o estructura no compatible. Los errores no reproducen rutas ni contenido del archivo.

La ejecución sobre el adjunto terminó con código **0**. El resultado real se conserva en [dataset-audit.json](dataset-audit.json): **138 comprobaciones**, **0 comprobaciones con defecto confirmado**, **1 observación que requiere un contrato de identidad**. Los conteos de filas afectadas en distintas comprobaciones pueden solaparse; no deben sumarse como entidades distintas.

## Semilla publicable y sanitización reproducible

[../../infra/data/seed-ticketing.json](../../infra/data/seed-ticketing.json) conserva las 14 colecciones y 8.762 filas del dataset entregado. Su generación usa una whitelist explícita de campos: los desconocidos se rechazan y nunca se copian por defecto. Se eliminaron los **616 campos `password`**; se sustituyeron nombres, correos, recintos y códigos de evento por valores sintéticos. Los correos usan el dominio reservado `example.test`. Las claves operativas de compra y escaneo se regeneran como UUIDv5 deterministas a partir de tabla, ID numérico y nombre de campo; no dependen de los valores originales.

Se conservaron **71.531 valores escalares de negocio**: IDs, referencias, estados, importes, cantidades, capacidad y fechas. También se conservaron `meta.casos_borde`, los conteos y la referencia temporal. Los IDs legados permanecen separados por tablas de rol y requieren el mapa de identidad indicado abajo. La aplicación debe generar o hashear sus credenciales de demostración al inicializar, sin recuperarlas del adjunto.

```bash
python3 scripts/sanitize-dataset.py /ruta/externa/datos-prueba-ticketing.json --output infra/data/seed-ticketing.json
python3 scripts/audit-dataset.py infra/data/seed-ticketing.json > /tmp/seed-audit.json
```

La sanitización ejecutada terminó con código **0**. [dataset-sanitization.json](dataset-sanitization.json) guarda su procedencia agregada. La semilla pesa **2.354.984 bytes** y su SHA-256 es:

```text
15775bef5da8b7ca6f58cba095bd81c017f621c7a9e4afb9d46acb7126834839
```

La auditoría de la semilla [seed-audit.json](seed-audit.json) terminó con código **0**, con las mismas **138 comprobaciones**, **0 defectos confirmados** y la misma observación de namespace de identidad. Se verificó en memoria que ninguna cadena sensible original aparece como valor en la semilla ni en el reporte agregado; no se imprimió ninguna cadena original. Una segunda generación en `/tmp` produjo exactamente los mismos bytes (`cmp`, código **0**). No se modificó el archivo original.

## Estructura observada

El JSON contiene `meta` y **14 colecciones con 8.762 registros**. Los conteos reales coinciden con los declarados en `meta.conteos`.

| Colección | Registros |
| --- | ---: |
| usuarios_administrativos | 1 |
| organizadores | 3 |
| staff | 12 |
| asistentes | 600 |
| eventos | 9 |
| zonas | 19 |
| fases_precio | 57 |
| puertas | 28 |
| asignaciones_staff | 27 |
| compras | 1.849 |
| entradas | 3.899 |
| transferencias | 176 |
| ingresos | 1.762 |
| reservas | 320 |

El resultado agregado documenta nombres de campos, tipos observados, presencia y valores nulos por colección. Es un inventario empírico de este adjunto, no un esquema oficial ni una validación contractual completa. Por ejemplo, `asignaciones_staff` se identifica por `(evento_id, staff_id)` y carece de `id` propio.

## Datos personales y credenciales

Se encontraron campos sensibles. Se reportan únicamente su presencia y conteos, nunca sus valores:

| Campo | Valores no vacíos | Tratamiento requerido |
| --- | ---: | --- |
| `nombre` | 672 | Puede contener identidad personal, además de etiquetas de negocio. |
| `email` | 616 | Identificador personal y de autenticación. |
| `password` | 616 | Tratar como credencial hasta confirmar su procedencia. |
| `idempotency_key` | 1.849 | Identificador operativo; evitar exposición en logs/documentación. |
| `client_scan_id` | 1.762 | Identificador operativo; evitar exposición en logs/documentación. |

Las 616 cadenas de contraseña tienen **4 valores distintos** y **ninguna coincide con los prefijos reconocidos por el auditor para bcrypt, Argon2, PBKDF2-SHA256 o scrypt**. Esta heurística no prueba su formato ni que sean credenciales reales o ficticias. No se publica ningún ejemplo y no se deben reutilizar como configuración de producción. Antes de implementar una semilla, confirmar el carácter sintético del fixture y aplicar hashing de contraseñas en el backend según el contrato aprobado.

No se guardan el JSON original ni fragmentos de filas originales. La evidencia persistida contiene agregados, fechas de negocio, nombres de campos e IDs numéricos técnicos. La semilla contiene identidades y claves operativas sintéticas. El auditor no imprime nombres, correos, contraseñas ni claves operativas; las compara solo en memoria cuando corresponde.

## Integridad e identidad

Las comprobaciones no detectaron IDs primarios duplicados **dentro** de una colección, referencias huérfanas ni contradicciones entre las relaciones redundantes de compra, entrada, zona, fase, evento y puerta. Las asignaciones de staff pertenecen al organizador de su evento, y los ingresos referencian staff asignado al evento según la fotografía disponible.

Los correos no se repiten entre las cuatro colecciones de identidades. Tampoco se repiten las claves de idempotencia de compra, los identificadores de escaneo ni los pares de asignación de staff. La ausencia de duplicados no demuestra que estén implementadas restricciones de unicidad ni define su alcance.

**Observación de migración:** existen **16 grupos de IDs numéricos compartidos entre colecciones de roles**, que involucran **32 filas** y representan **16 filas extra** respecto de un namespace global. Es coherente si cada tabla tiene su propio namespace; no es un defecto confirmado del dataset. Para una tabla unificada de usuarios, conservar un mapa explícito `(colección/rol, id_legado) → id_interno` y resolver cada FK con su rol de destino. Reutilizar directamente el número legado puede mezclar identidades y permisos. El agregado incluye únicamente los IDs técnicos afectados.

## Importes, entradas y accesos

`meta` declara **USD** y **centésimos enteros**. Los importes observados son enteros no negativos; las cantidades son positivas. Para cada compra, `cantidad × precio_unitario_centesimos = monto_centesimos`. El precio unitario coincide con la fase vinculada, y el número de entradas coincide con la cantidad comprada.

| Estado de compra | Compras | Entradas | Importe en centésimos | Equivalente USD |
| --- | ---: | ---: | ---: | ---: |
| pagada | 1.739 | 3.664 | 14.626.100 | 146.261,00 |
| reembolsada | 110 | 235 | 1.039.380 | 10.393,80 |

Son sumas del fixture, sin evidencia de cargos, liquidaciones o pagos externos. El agregado no interpreta el importe reembolsado como facturación activa.

Las entradas se distribuyen en **1.810 pagadas, 92 transferidas, 1.762 usadas y 235 reembolsadas**. Cada entrada usada tiene exactamente un ingreso válido; los 1.762 ingresos válidos referencian entradas usadas. No hay múltiples ingresos válidos para una misma entrada. Las compras y sus entradas coinciden en la marca de reembolso bajo la hipótesis de reembolso de compra completa. Esto no prueba rechazo concurrente de dobles escaneos.

Hay **175 transferencias aceptadas y 1 pendiente**. El destinatario de la última transferencia aceptada coincide con el titular actual, y el emisor de la transferencia pendiente coincide con el titular de su entrada. Los estados aceptados/pending y sus fechas de resolución son coherentes. No hay transferencia a la misma identidad. No se puede demostrar revocación de credenciales ni compatibilidad criptográfica con estos datos.

## Tiempo, reservas e inventario

La referencia de la fotografía es **2026-09-01 06:00 UTC**, tomada de `meta.referencia_temporal`. Se utiliza para los cálculos del fixture, en lugar del reloj de ejecución. El resultado registra rangos de fechas y el número de fechas posteriores a esa referencia; los eventos y fases futuros son datos de planificación y no defectos.

Las fechas no nulas procesadas son ISO-8601 con zona horaria. Las ventas abren antes de sus eventos; los límites de reembolso no están después de la fecha del evento. Los intervalos de fase tienen duración positiva. En las 19 zonas hay 3 fases de precio sin solapamientos ni huecos entre fases consecutivas. Todas las fechas de pago caen dentro de la fase vinculada con la hipótesis de intervalo **`[desde, hasta)`**. La política real debe confirmar ese límite y fijar el precio al reservar, cuya fecha no está vinculada a las compras en este archivo.

Los reembolsos registrados son posteriores o simultáneos al pago y no posteriores al límite del evento. Las resoluciones de transferencia son posteriores o simultáneas a su creación. Los ingresos ocurren después de la emisión de su entrada, y su sincronización es posterior o simultánea al escaneo. Una fotografía consistente no prueba la política de pagos tardíos, excepciones administrativas ni tolerancias de reloj.

Las **320 reservas figuran expiradas**, todas vencieron antes de la referencia y duran **600 segundos**. No hay reservas activas futuras en esta fotografía. No existen enlace a compra, clave de idempotencia ni snapshot de precio en esas reservas. Por ello no se puede deducir cómo se transformaron en ventas, si ocuparon cupo dos veces o cómo se recuperan tras reiniciar un proceso.

Para disponibilidad se contabilizan `pagada`, `transferida` y `usada` como cupo consumido; `reembolsada` libera cupo. Conservar las usadas evita vender de nuevo un asiento ya consumido. La resta de reservas activas no vencidas es un escenario adicional, pendiente de confirmar que no estén contabilizadas también en compras. **Ninguna zona tiene stock negativo bajo estos cálculos.** El agregado conserva el inventario de cada zona.

## Casos de borde declarados

Los cinco casos de `meta.casos_borde` coinciden con los datos:

| Caso | Evidencia verificada |
| --- | --- |
| Últimas 50 entradas | Evento `4`, zona `8`: aforo `500` menos `450` entradas no reembolsadas = **50**. |
| Entrada usada | Entrada `5` en estado usada, con **1** ingreso válido. |
| Transferencia pendiente | Transferencia `176` pendiente y resolución nula. |
| Límite alcanzado | Asistente `77`, evento `5`: **4** entradas no reembolsadas compradas, con límite **4**. |
| Evento ajeno | Organizador `201` existe y no es dueño del evento `5`. |

No hay pares usuario/evento por encima del límite en los escenarios de comprador original o titular actual. Que ambos escenarios produzcan este resultado no determina cuál debe aplicar la regla de negocio, cómo afectan transferencias/reembolsos ni cómo se serializa el control concurrente.

## Contratos pendientes antes de cargar o implementar

1. Mantener trazabilidad de estados, relaciones y obligatoriedad de campos con el enunciado recibido y documentar cualquier detalle no especificado.
2. Confirmar procedencia sintética, permisos de uso y tratamiento de las credenciales del fixture.
3. Definir la identidad global y el mapa de IDs por colección para una semilla idempotente que no colisione ni escale privilegios.
4. Definir unicidad y alcance de email, clave de idempotencia y UUID de escaneo; respuesta a claves reutilizadas con payload distinto.
5. Definir vínculo reserva-compra-pago, precio bloqueado, expiración de 600 segundos o plazo configurable y política de pago tardío.
6. Precisar qué consume aforo, cuándo se descuenta/libera, qué reservas ya están convertidas y cómo se aplican cuotas por comprador/titular y evento.
7. Confirmar límites temporales de fases y reembolso, reembolso parcial/total y excepciones administrativas. Para la semilla se adopta desplazar todas las fechas por un único delta respecto de `meta.referencia_temporal`, con un ancla de primera inicialización persistida en base de datos; verificar que ejecuciones posteriores no vuelvan a desplazar registros. La alternativa de reloj controlado queda disponible para pruebas sobre el archivo histórico.
8. Definir los datos ausentes de dispositivos, claves públicas, versiones de titularidad, revocaciones incrementales, credenciales, intentos rechazados, incidentes y auditoría de autor/motivo.

Las garantías de no sobreventa, idempotencia, autenticidad y único ingreso lógico **siguen pendientes de implementar y probar** en PostgreSQL, API y dispositivos. Esta auditoría verifica un archivo estático y ofrece una base reproducible para diseñar la semilla y los escenarios de QA.
