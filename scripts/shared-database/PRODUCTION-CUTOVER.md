# Corte coordinado de las dos aplicaciones

El ejecutor está preparado para un corte revisado. **Prepararlo o pasar `dry-run` no autoriza ejecutar ni detener las aplicaciones.** No carga `.env`, no crea usuarios, no borra la base blanca, no despliega código y no modifica configuraciones de Coolify. Conserva el IVA negro registrado en las filas canónicas y la versión fiscal blanca auténtica en el archivo inmutable usado por su lector.

## Evidencia necesaria

Copiar los dos ejemplos JSON a una carpeta privada ignorada por Git y sustituir únicamente datos comprobados. Los ejemplos tienen indicadores falsos e identidades inválidas a propósito.

1. Confirmar las versiones de ambas aplicaciones y el mecanismo de aislamiento. Detener todos sus procesos escritores, tareas, reintentos y réplicas; impedir nuevas conexiones de esas aplicaciones durante todo el corte. Registrar los recursos y commits reales.
2. Con los escritores ya detenidos, ejecutar la captura de ambas bases. Fijar previamente las identidades observadas: endpoint, base, OID, propietario, usuario de sesión y `pg_control_system().system_identifier`. No se aceptan identidades descubiertas y aprobadas automáticamente durante la escritura.
3. Crear los respaldos nativos dentro de los mismos snapshots exportados que las filas, esquema y estado completo. Restaurar ambos en bases independientes y verificar los mismos archivos por SHA256. Las pruebas necesitan filas, esquema, secuencias (`last_value` e `is_called`), objetos grandes y metadatos reales; no basta con un conteo de filas.
4. Si la restauración local cambia propietarios/ACL intencionalmente, conservarlos en el archivo nativo y declarar la limitación exacta. `reviewedRestorationLimitations` debe copiar literalmente las limitaciones revisadas de cada prueba. No declarar igualdad de propietarios que no se comprobó.
5. Revisar el plan, código, SQL, payload de permisos del usuario existente y UUID de producción nuevo. El paquete fija todos esos hashes. La captura y constancia de mantenimiento deben tener menos de una hora; el respaldo debe ser posterior a la detención.

Los archivos de conexión se pasan por separado y contienen exclusivamente `host`, `port`, `database`, `user`, `password` y `ssl`. No incluirlos en Git ni en los reportes. El destino está fijado a `72.62.83.230:7453/postgres`; la base blanca sólo admite lectura en `72.62.83.230:12458/postgres`.

## Comandos

Las rutas siguientes son marcadores; no son un paquete ejecutable.

```powershell
node scripts/shared-database/install-production.mjs dry-run --request-file C:/PRIVADO/request.json
node scripts/shared-database/install-production.mjs check --request-file C:/PRIVADO/request.json --black-connection-file C:/PRIVADO/negra-connection.json --white-connection-file C:/PRIVADO/blanca-connection.json
```

`dry-run` es completamente local y devuelve conteos, hashes y bloqueos. `check` conecta ambas bases en sólo lectura, verifica identidad, permisos y deriva respecto de los respaldos. No garantiza que los escritores permanecerán detenidos: la comprobación se repite al ejecutar.

El corte revisado requiere ambos hashes exactos devueltos por un `dry-run` sin bloqueos:

```powershell
node scripts/shared-database/install-production.mjs execute --request-file C:/PRIVADO/request.json --black-connection-file C:/PRIVADO/negra-connection.json --white-connection-file C:/PRIVADO/blanca-connection.json --confirm-plan-sha256 SHA256_PLAN_REVISADO --confirm-package-sha256 SHA256_PAQUETE_REVISADO --report-file C:/PRIVADO/result.json
```

El destino se modifica en **una sola transacción**. Se bloquean sus tablas antes de comparar todas las filas y metadatos; cualquier diferencia aborta antes del primer DDL/DML. Se verifica el resultado, archivos, mapas, operaciones y permisos, y se vuelve a comprobar la base blanca antes del único `COMMIT`.

La sesión blanca es `READ ONLY`: sus bloqueos `ACCESS SHARE` protegen contra DDL incompatible, pero **no bloquean INSERT/UPDATE/DELETE**. Por eso son obligatorios el aislamiento externo, ausencia de otros clientes y la segunda comprobación. El ejecutor no mata conexiones ni deshabilita seguridad para conseguirlo.

Si se pierde la respuesta de `COMMIT`, no repetir `execute`, no compensar existencias ni restaurar automáticamente. Consultar el marcador durable:

```powershell
node scripts/shared-database/install-production.mjs status --request-file C:/PRIVADO/request.json --black-connection-file C:/PRIVADO/negra-connection.json
```

`status` sigue disponible tras vencer la ventana; nunca autoriza una reaplicación. Después del corte se deben configurar y validar ambas aplicaciones con el UUID de producción y sus usuarios revisados antes de levantar el aislamiento. La base blanca permanece intacta como evidencia, con sus escritores detenidos. Reabrir una versión antigua que use las dos bases requiere una revisión separada de recuperación.

## Ensayos

`production.test.mjs` prueba guardias, deriva, límites de transacción, archivos completos y respuesta de COMMIT perdida. `production-rehearsal.mjs` admite únicamente la instancia de pruebas `127.0.0.1:55439` y crea dos clones nuevos; inyecta fallos reales antes/después del merge y un cambio tardío en la fuente blanca. Conserva los clones como evidencia y no toca la base de desarrollo principal.
