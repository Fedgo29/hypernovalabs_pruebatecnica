# Corrección de arranque desde Windows

El log aportado muestra PostgreSQL saludable y `initialize` terminado con 255:
`exec /app/api-entrypoint.sh: no such file or directory`. La imagen sí copia ese
archivo. Un shebang con CRLF hace que Linux busque `/bin/sh\r` y produzca el mismo
mensaje, aunque el script exista.

Se reprodujo con una copia CRLF del entrypoint real, montada en un contenedor
Node 22 Alpine: ejecución directa fallida con el mismo error. La misma copia
normalizada a LF, con permiso 755 y un destino Node mínimo, arrancó correctamente
y produjo `entrypoint_crlf_ok` con código 0.

Correcciones:

- `.gitattributes` fuerza LF para scripts shell, Dockerfile y YAML.
- El Dockerfile elimina CR de final de línea antes de ejecutar el entrypoint.
  Esto también protege clones existentes, cuyos archivos quizá sigan en CRLF
  después de actualizar Git.

Se reconstruyó y arrancó el stack real: inicialización terminó con código 0,
PostgreSQL/API/portal saludables y readiness devolvió `{"status":"ready"}`.
No se eliminaron volúmenes. Las comprobaciones se ejecutaron en Linux con una
copia CRLF deliberada; la confirmación final en el Windows del usuario sigue
dependiendo de actualizar y reconstruir allí.
