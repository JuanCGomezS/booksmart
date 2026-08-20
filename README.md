# BookSmart

BookSmart es una plataforma de agendamiento para negocios que atienden por cita: barberías, salones de belleza, estudios de uñas, clínicas dentales y otros equipos de servicios.

## Inicio rápido

1. Instala dependencias con `npm install`.
2. Copia las variables de Firebase de `.env.example` a `.env` y completa sus valores.
3. Ejecuta `npm run dev` para desarrollo local o `npm run build` para generar producción.

| Capa                  | Tecnología                           |
| --------------------- | ------------------------------------ |
| Sitio y rutas         | Astro 7                              |
| UI interactiva        | React 19                             |
| Mapas                 | React Leaflet + OpenStreetMap        |
| Estilos               | Tailwind CSS 4                       |
| Datos y autenticación | Firebase / Firestore / Firebase Auth |
| Despliegue web        | GitHub Pages                         |
| Backend público       | Firebase Functions + Rules           |

## Producto

- Landing pública para explicar el producto y sus planes.
- Super admin para crear y administrar negocios, planes y accesos.
- Página pública por negocio en `/b/<slug>`.
- Agenda, servicios, catálogo, productos y equipo como módulos de operación.

La UI usa el término **negocio** como concepto de plataforma. Cada alta nueva declara una categoría: barbería, salón de belleza, estudio de uñas, clínica dental u otro negocio por cita.

## Firebase y compatibilidad de datos

BookSmart conserva deliberadamente la colección Firestore histórica `barbers` y sus subcolecciones, además de los campos internos como `barberId` y roles existentes. Renombrarlos en producción separaría los documentos ya creados de citas, servicios, productos y permisos asociados.

| Elemento             | Decisión                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Colección principal  | Se mantiene `barbers` por compatibilidad.                                                                         |
| Categoría visible    | Los negocios nuevos guardan `businessType`.                                                                       |
| Registros anteriores | Al leer un documento sin `businessType`, la app lo interpreta como `barbershop`. No se requiere migración masiva. |
| Cambio de categoría  | La capa de datos admite actualizar `businessType`; la UI de edición completa queda como siguiente trabajo.        |

No se cambian reglas de Firestore ni rutas públicas en este rebrand: siguen autorizando y resolviendo el almacenamiento heredado.

## Configuración local

El proyecto requiere las variables públicas de Firebase que aparecen en `.env.example`. El script administrativo también requiere `FIREBASE_SERVICE_ACCOUNT_JSON` cuando se usa para crear el superadmin.

| Comando                                                        | Resultado                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`                                                  | Inicia Astro en desarrollo local con base `/`.                                               |
| `npm run build`                                                | Genera el sitio estático de producción.                                                      |
| `npm run preview`                                              | Sirve el build local.                                                                        |
| `npx tsx scripts/seed-superadmin.ts <email> <password> <name>` | Crea o actualiza el primer superadmin si las credenciales administrativas están disponibles. |

## Despliegue en GitHub Pages

La configuración de Astro usa `/booksmart/` como `base` solo en producción y `/` en desarrollo. Para que el sitio publicado coincida, el propietario debe renombrar el repositorio de GitHub a `booksmart` y confirmar que GitHub Pages continúe desplegando desde GitHub Actions. El workflow ya construye con `npm run build` y recibe las variables `PUBLIC_FIREBASE_*` desde GitHub Secrets.

Si el repositorio conserva otro nombre, se debe ajustar `base` en `astro.config.mjs` al nombre real antes de desplegar. No se debe publicar con `/barberflow/`, porque los enlaces y assets generados usarán `/booksmart/`.

### Backend público, imágenes y permisos de Firebase

La página pública carga el negocio, productos, servicios, profesionales y política de agenda desde la callable `getPublicBusinessBySlug`. La callable consulta las fuentes canónicas autorizadas y devuelve sólo el DTO público allowlisted; la página y `createPublicBooking` no requieren una proyección ni un backfill manual para funcionar.

El workflow de GitHub Pages solo publica el sitio estático. **No despliega Functions ni Rules de Firebase** y no debe asumir un proyecto o credenciales de Firebase.

El propietario con acceso al proyecto Firebase debe ejecutar, desde este repositorio y con el proyecto correcto seleccionado:

```bash
npm run deploy:backend
```

Este script ejecuta `npx firebase-tools deploy --only functions,firestore:rules,storage`. `firebase.json` compila Functions con su hook `predeploy` antes de empaquetar. Para automatizarlo después, el propietario debe configurar autenticación de Firebase y el identificador de proyecto en CI; no se deben inventar secretos ni IDs. Hasta entonces, cualquier error de autorización de imágenes debe tratarse como un bloqueo de lanzamiento.

Las imágenes de Catálogo y Productos se guardan como assets inmutables bajo el registro (`.../{recordId}/assets/{uuid}.{ext}`). Al reemplazar una imagen, la anterior se conserva hasta que la nueva carga y su referencia de Firestore se confirman; después se intenta limpiarla. Las rutas históricas `image.{ext}` se mantienen legibles y eliminables para compatibilidad, pero no aceptan cargas nuevas.

Las imágenes públicas de marca, catálogo, productos y profesionales sólo se sirven cuando el negocio canónico está operativo: `active: true`, suscripción `active` o `trial`, inicio efectivo alcanzado y expiración vigente. Las escrituras privadas conservan sus roles actuales.

Los servicios y profesionales de agenda no son legibles anónimamente desde Firestore. La callable filtra los activos y emite sólo los campos necesarios: servicio (`id`, `name`, `duration`, `bufferMinutes`, `staffIds`) y profesional (`id`, `name`, `schedule`). Los locks de disponibilidad permanecen sin PII y se leen sólo para la fecha/profesional que el visitante consulta.

La limpieza de Storage ya no depende de `localStorage`: al reemplazar una imagen, el registro conserva `pendingImageCleanupPaths` hasta que el cliente elimina el asset anterior, y el cliente reintenta esas rutas al cargar o modificar esa colección. Al eliminar un registro, primero se eliminan sus assets; si Storage falla, el documento se conserva para reintentar. Esto reduce huérfanos en la arquitectura actual, pero **no sustituye un worker server-side**: una función programada o cola con privilegios administrativos sigue siendo el siguiente endurecimiento para garantizar limpieza si ningún cliente vuelve a abrir el contenido.

La callable emite productos activos con sus campos comerciales (nombre, descripción, precio, imagen y etiquetas), nunca `stock`. Crear, editar, activar, desactivar o cambiar la imagen o el precio se refleja en la siguiente carga pública desde la escritura canónica normal; no existe una proyección pública, sincronización, scheduler ni backfill requerido.

Las reservas públicas se crean exclusivamente mediante la Function callable `createPublicBooking`; las reglas rechazan escrituras públicas directas de citas y locks. La Function valida servicios, profesional, cierres, locks, productos y la regla de una solicitud activa por teléfono normalizado, negocio y fecha local de Colombia. Los estados `pending` y `confirmed` ocupan esa regla; una reserva `cancelled`, `done` o `no_show` no bloquea una nueva solicitud para el mismo día.

El despliegue de esta frontera debe ser atómico: `firebase.json` ejecuta obligatoriamente `npm --prefix functions run build` mediante el hook `predeploy` antes de empaquetar cualquier despliegue que incluya Functions. Así, `functions/package.json` siempre carga un `lib/index.js` recién generado desde `functions/src/index.ts`. Despliega Function y ambas Rules en el mismo comando. GitHub Pages no realiza este despliegue.

```bash
npm run deploy:backend
```

No se habilitó App Check ni se usa IP como identificador de la regla. App Check requiere configuración explícita separada antes de activarse.

### Ubicación pública del negocio

El administrador selecciona directamente el punto exacto del negocio en el mapa de OpenStreetMap desde Administración → Negocio. Se almacenan `config.location.latitude` y `config.location.longitude`; la dirección es texto complementario. La página `/b/<slug>` muestra el mismo marcador en modo de solo lectura. Los registros heredados con `placeUrl` se conservan, pero la interfaz ya no depende de Google Maps ni de claves, URLs de lugar o facturación de Google.

### Verificación actual

En esta etapa no se mantienen ni ejecutan pruebas automatizadas. Antes de publicar cambios, usa estas verificaciones manuales del repositorio:

| Comando            | Resultado                                               |
| ------------------ | ------------------------------------------------------- |
| `npx tsc --noEmit` | Comprueba los tipos de TypeScript sin generar archivos. |
| `npm run build`    | Genera el sitio estático de producción.                 |
| `git diff --check` | Detecta errores de espacios en blanco en los cambios.   |

## Contacto de marca

Los enlaces de email e Instagram todavía apuntan a cuentas históricas `barberflow`. No se inventaron credenciales para BookSmart: el propietario debe proporcionar o configurar los canales finales antes de la publicación comercial.

## Documentación de producto

`PLAN_DE_TRABAJO.md` distingue el fundamento ya entregado de las siguientes fases para negocios por cita.
