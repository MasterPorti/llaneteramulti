# LlanteraMulti

Aplicación de inventario, servicios, catálogo y ventas con Next.js 16 y PostgreSQL. El backend utiliza el esquema normalizado de la base publicada: columnas `snake_case`, encabezados en `ventas` y conceptos en `venta_items`.

**Corte definitivo de producción: pendiente de ejecución y verificación.** El código y las herramientas están preparados y se han probado en un clon aislado. Este documento no confirma que el traslado a la base publicada se haya ejecutado. La evidencia del corte será el reporte de aplicación, su comprobación posterior al COMMIT y la activación documentada.

## Configuración e inicio local

Configurar un `.env.local` privado a partir de las variables descritas en `.env.example`, usando las credenciales y el nombre del **clon de desarrollo preparado**. No sobrescribir un archivo de conexión existente. Los archivos `.env*` privados y `.migration-backups/` están excluidos de Git.

```powershell
cd C:\dev\llaneteramulti
npm ci
npm run dev
```

Abrir [http://127.0.0.1:3000](http://127.0.0.1:3000). Para otro puerto: `npm run dev -- --port 3010`. El servidor de desarrollo escucha en `127.0.0.1`.

Mantener una sola instancia por carpeta. Si aparece `.next/dev/lock`, detener la instancia anterior con `Ctrl+C` en su terminal. No eliminar el bloqueo mientras sigue ejecutándose.

Las rutas principales son `/llantas`, `/productos`, `/servicios`, `/ventas` y `/historial`. Las pantallas de `/inventario/ventas` siguen disponibles para la operación con folios SI. Ambas interfaces consultan las mismas filas PostgreSQL.

## Conexión al modelo publicado

La base definitiva seleccionada se llama `postgres`. El nombre por sí solo no identifica un servidor: se debe usar el endpoint y el rol incluidos en el plan revisado. `llaneteramulti_new_tires` corresponde a la etapa anterior y es la fuente del lote que se incorporará; cambiar únicamente la URL no convierte su esquema anterior en el esquema normalizado.

| Variable | Uso |
| --- | --- |
| `DATABASE_URL` | Endpoint aprobado y credenciales del usuario existente `admmin`. En producción apunta a `/postgres`; para desarrollo, al clon preparado. |
| `LLANTERA_EXPECTED_DATABASE` | Obligatoria. `postgres` en el destino definitivo; el nombre exacto del clon en desarrollo. Se compara con la URL y con `current_database()`. |
| `LLANTERA_APPLICATION_ID` | Obligatoria. Valor `applicationName` del plan: `llm:` seguido por los primeros 48 caracteres hexadecimales del SHA-256 del artefacto revisado. El pool lo envía como `application_name` y comprueba la marca recibida por PostgreSQL. |
| `LLANTERA_SUPPLIER` | `COMERCIALIZADORA DE NEW TIRES`, proveedor permitido al crear o editar llantas. No limita el catálogo de servicios y productos ya publicado. |
| `DB_REQUIRE_SSL` | `true` cuando el servidor requiere TLS. Debe corresponder a la configuración real del endpoint. |
| `DB_SSL_REJECT_UNAUTHORIZED` | Mantener `true` para validar el certificado cuando se use TLS. |

Antes de consultar datos, `lib/db.ts` exige `migration_new_tires.runtime_setup` con versión `1`. Una base sin esa instalación se rechaza. El arranque de la aplicación no crea tablas, no carga servicios de ejemplo y no migra datos automáticamente.

Por decisión del propietario se reutiliza el usuario existente `admmin`; este corte no crea usuarios ni cambia sus permisos. El control de escritura exige el usuario esperado, el estado activado y la marca exacta de la versión. La aplicación falla al conectar si falta `LLANTERA_APPLICATION_ID`, su formato no es válido o la sesión recibe otra marca. Cambiar la marca crea un pool nuevo.

La marca identifica el artefacto y evita escrituras accidentales del backend anterior, que no la envía. No es una contraseña ni restringe los privilegios del propietario: ese usuario puede cambiar parámetros de sesión o administrar los controles de la base. Por ello se detienen los procesos anteriores y se comprueban el artefacto y las variables del contenedor real antes de activar. Los controles de historial, IVA y existencias permanecen habilitados.

## Datos que debe conservar el corte

Los conteos siguientes describen el lote revisado y los datos publicados que se conservarán, antes de ventas o ajustes nuevos:

| Información | Publicado existente | Lote New Tires | Resultado esperado |
| --- | ---: | ---: | ---: |
| Llantas | 0 | 134 | 134 |
| Ventas | 2 | 465 | 467 |
| Conceptos de venta | 2 | 599 | 601 |
| Movimientos de bodega | 0 | 489 | 489 |
| Servicios, incluidos inactivos | 16 | 0 | 16 |
| Productos de catálogo | 1 | 0 | 1 |
| Bodegas | 0 | 8 | 8 |

Las 134 llantas incluyen 104 activas y 30 inactivas. Las unidades disponibles son **185**; otras **429** pertenecen a registros inactivos y no se suman a lo disponible.

Las dos ventas mixtas conservan todos sus conceptos. Dos llantas de otros proveedores quedan únicamente en `migration_new_tires.context_tires`, con sus relaciones en `item_context`; no se incorporan al inventario vendible.

El archivo `migration_new_tires` conserva las filas originales, documentos completos, metadatos, configuración auténtica de bodegas y los seis archivos JSON recuperados de la aplicación publicada. Estos JSON se conservan como evidencia; no se mezclan automáticamente con el inventario operativo ni se usan para crear registros de ejemplo. Los campos adicionales y documentos previos al desglose de IVA permanecen en ese archivo.

Las 465 ventas importadas y sus partidas son de solo lectura. Los controles de PostgreSQL y del backend impiden modificarlas, cancelarlas o facturarlas nuevamente. Las dos ventas que ya existían en la base publicada conservan sus valores originales, incluidos IVA cero y campos NULL.

## Ventas, IVA y existencias

Las ventas nuevas desglosan el **16% incluido en el precio**: `subtotal = round(total / 1.16, 2)` e `iva = total - subtotal`. El total cobrado se conserva. El servidor calcula los importes desde precios y cantidades; no acepta un subtotal, impuesto o total calculado por el cliente como autoridad.

El cálculo compartido de `lib/utils/iva.ts` trabaja en centavos. Encabezado, partidas, folio, garantía, existencias y movimientos se registran en la misma transacción. PostgreSQL también exige que las partidas concilien con el total. Ticket, aplicación y CSV presentan los importes persistidos.

La política de IVA se registra en `ventas.iva_politica`. Las ventas nuevas y el historial New Tires ya desglosado usan `incluido_16`; las dos ventas publicadas anteriores conservan su política NULL e IVA registrado de cero. No volver a aplicar el backfill anterior sobre la base combinada.

Las ventas generales reciben folios `V-`; las creadas desde la interfaz de inventario reciben `SI-`. `app_metadata` mantiene contadores separados, bloqueados dentro de la transacción. Las garantías usan una secuencia compartida para evitar colisiones. Una venta sin plazo de garantía no recibe una garantía activa ficticia.

Las llantas mantienen `stock` y `stock_por_bodega` juntos. Ventas, cancelaciones, ajustes y traslados actualizan ambos valores de forma atómica y registran el movimiento correspondiente. La cantidad por bodega debe ser entera, no negativa y sumar el total. Los productos de catálogo conservan su propio stock; si no existe costo de compra documentado, `precio_compra` permanece NULL.

La facturación electrónica no está integrada al registro de ventas: no se generan UUID ni CFDI simulados. Un enlace externo a un servicio de facturación no implica que la venta haya quedado timbrada o enviada fiscalmente.

## Operación del corte publicado

El runner específico es `scripts/migration/published-merge-production.mjs`. Las herramientas de la primera migración (`migrate-new-tires.mjs`, `retirement.mjs` e `iva-backfill.mjs`) corresponden a etapas anteriores; no son el procedimiento para incorporar el lote a la base publicada.

El corte utiliza cuatro modos:

1. **`prepare`**: requiere respaldos nativos recientes de ambas bases con restauración verificada, evidencia de escritores detenidos, los documentos y JSON autenticados, el artefacto de aplicación y la identidad del usuario existente. Consulta las bases en solo lectura y genera `plan.json` y su SHA-256. El plan fija identidades de servidor/base, hashes de código, respaldos, todos los documentos, artefacto y marca de versión.
2. **`apply`**: exige la ruta del plan y su hash revisado. Revalida el paquete y el estado vivo, bloquea tablas e incorpora el lote sin sustituir los registros publicados. Verifica correspondencia de filas, archivos, relaciones y secuencias antes de un único COMMIT. El destino queda con escrituras **bloqueadas**, aunque la importación termine correctamente.
3. **`status`**: consulta el marcador persistido del lote y su estado. Es la vía de recuperación si una desconexión deja incierto el resultado del COMMIT; no repetir `apply` para averiguarlo. Un intento revertido puede haber consumido valores de la secuencia de partidas, por lo que requiere un paquete nuevo antes de reintentar.
4. **`activate`**: exige el mismo plan, evidencia revisada del artefacto realmente desplegado, pruebas de lectura y conexión con `admmin` y la marca exacta de versión. Activa la escritura para esa combinación de usuario y marca. Las conexiones del backend anterior, que no llevan la marca aprobada, quedan bloqueadas por los controles de escritura.

Los indicadores de los archivos de evidencia deben corresponder a comprobaciones reales: no sustituyen el paro de contenedores/procesos, la revisión del endpoint o la comprobación del artefacto desplegado. La fuente debe permanecer detenida después del corte. El runner no modifica sus filas ni realiza ventas sintéticas en producción.

No restaurar un respaldo sobre una base con operación posterior sin detenerla y conciliar sus cambios. Ante un resultado incierto, conservar el plan, su hash y los reportes del intento; consultar `status` antes de tomar otra acción.

## Respaldos y verificación

`.migration-backups/` contiene información privada de la operación. Mantener los paquetes completos y una copia independiente. Los respaldos nativos incluyen datos, esquema, propietarios, permisos, secuencias y objetos grandes; los reportes de restauración y los manifiestos permiten cotejar su integridad.

Los paquetes `new-tires-2026-10-11T23-21-25.623Z-cc8f344f/` y los reportes de retiro o IVA de la etapa previa documentan su propio momento. No acreditan por sí mismos la ejecución del corte publicado. Para este corte, buscar el paquete `published-production-<lote>/`, su plan, `verified-before-commit.json`, `complete.json`, el resultado de `status` y el reporte de activación correspondiente.

Pruebas locales sin escrituras en bases:

```powershell
npm run test:migration
npm run test:iva
npx tsc --noEmit
npm run build
```

Las suites unitarias comprueban selección, preservación, validaciones y mapeo del esquema normalizado. Las pruebas reales están en `scripts/migration/published-app-integration.test.mjs` y requieren un clon restaurado explícito; rechazan el nombre de la base productiva. Comprueban ventas, rollback, IVA, folios, stock concurrente, cancelación y conservación de los registros originales tras retirar los datos de prueba. Los contadores del clon pueden avanzar durante esas pruebas y se comprueba que sigan siendo coherentes; no se confunden con datos reales de ventas. Los controles de escritura deben probarse también en el clon con el mismo usuario: una sesión sin la marca de versión debe quedar bloqueada y otra con la marca aprobada debe funcionar al activar.

Un ensayo satisfactorio acredita el comportamiento en ese clon. La producción sólo se considera completada después de sus verificaciones y activación propias.
