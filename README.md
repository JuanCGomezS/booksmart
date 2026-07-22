# BookSmart

BookSmart es una plataforma de agendamiento para negocios que atienden por cita: barberías, salones de belleza, estudios de uñas, clínicas dentales y otros equipos de servicios.

## Inicio rápido

1. Instala dependencias con `npm install`.
2. Copia las variables de Firebase de `.env.example` a `.env` y completa sus valores.
3. Ejecuta `npm run dev` para desarrollo local o `npm run build` para generar producción.

| Capa | Tecnología |
| --- | --- |
| Sitio y rutas | Astro 6 |
| UI interactiva | React 19 |
| Estilos | Tailwind CSS 4 |
| Datos y autenticación | Firebase / Firestore / Firebase Auth |
| Despliegue | GitHub Pages |

## Producto

- Landing pública para explicar el producto y sus planes.
- Super admin para crear y administrar negocios, planes y accesos.
- Página pública por negocio en `/b/<slug>`.
- Agenda, servicios, catálogo, productos y equipo como módulos de operación.

La UI usa el término **negocio** como concepto de plataforma. Cada alta nueva declara una categoría: barbería, salón de belleza, estudio de uñas, clínica dental u otro negocio por cita.

## Firebase y compatibilidad de datos

BookSmart conserva deliberadamente la colección Firestore histórica `barbers` y sus subcolecciones, además de los campos internos como `barberId` y roles existentes. Renombrarlos en producción separaría los documentos ya creados de citas, servicios, productos y permisos asociados.

| Elemento | Decisión |
| --- | --- |
| Colección principal | Se mantiene `barbers` por compatibilidad. |
| Categoría visible | Los negocios nuevos guardan `businessType`. |
| Registros anteriores | Al leer un documento sin `businessType`, la app lo interpreta como `barbershop`. No se requiere migración masiva. |
| Cambio de categoría | La capa de datos admite actualizar `businessType`; la UI de edición completa queda como siguiente trabajo. |

No se cambian reglas de Firestore ni rutas públicas en este rebrand: siguen autorizando y resolviendo el almacenamiento heredado.

## Configuración local

El proyecto requiere las variables públicas de Firebase que aparecen en `.env.example`. El script administrativo también requiere `FIREBASE_SERVICE_ACCOUNT_JSON` cuando se usa para crear el superadmin.

| Comando | Resultado |
| --- | --- |
| `npm run dev` | Inicia Astro en desarrollo local con base `/`. |
| `npm run build` | Genera el sitio estático de producción. |
| `npm run preview` | Sirve el build local. |
| `npx tsx scripts/seed-superadmin.ts <email> <password> <name>` | Crea o actualiza el primer superadmin si las credenciales administrativas están disponibles. |

## Despliegue en GitHub Pages

La configuración de Astro usa `/booksmart/` como `base` solo en producción y `/` en desarrollo. Para que el sitio publicado coincida, el propietario debe renombrar el repositorio de GitHub a `booksmart` y confirmar que GitHub Pages continúe desplegando desde GitHub Actions. El workflow ya construye con `npm run build` y recibe las variables `PUBLIC_FIREBASE_*` desde GitHub Secrets.

Si el repositorio conserva otro nombre, se debe ajustar `base` en `astro.config.mjs` al nombre real antes de desplegar. No se debe publicar con `/barberflow/`, porque los enlaces y assets generados usarán `/booksmart/`.

## Contacto de marca

Los enlaces de email e Instagram todavía apuntan a cuentas históricas `barberflow`. No se inventaron credenciales para BookSmart: el propietario debe proporcionar o configurar los canales finales antes de la publicación comercial.

## Documentación de producto

`PLAN_DE_TRABAJO.md` distingue el fundamento ya entregado de las siguientes fases para negocios por cita.
