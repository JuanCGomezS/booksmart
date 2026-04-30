# BarberFlow

**BarberFlow** es una plataforma para barberías que busca resolver una necesidad muy concreta: dejar de operar el negocio en pedazos.

Agenda, catálogo, productos, operación diaria y crecimiento comercial viven en un solo lugar, con una experiencia pensada para negocios reales, no para demos bonitas.

El proyecto está construido para ser rápido, mantenible y viable desde el día cero, incluso con infraestructura gratuita.

## La esencia del proyecto

BarberFlow nace de una idea simple: una barbería no necesita diez herramientas separadas para funcionar bien.

Necesita orden.
Necesita una agenda clara.
Necesita mostrar bien su trabajo.
Necesita vender más.
Necesita entender cómo va el negocio sin entrar a sistemas complejos.

Por eso BarberFlow combina presencia digital, gestión operativa y control comercial en una sola plataforma enfocada en barberías y pensada para crecer con ellas.

## Qué busca resolver

- Reservas desordenadas por WhatsApp o llamadas.
- Falta de visibilidad sobre horarios, disponibilidad y servicios.
- Catálogos de cortes y productos dispersos o inexistentes.
- Poca trazabilidad sobre clientes, citas y rendimiento del negocio.
- Dependencia de herramientas costosas o sobredimensionadas.

## Propuesta de valor

- Una landing pública clara para presentar el producto.
- Un super admin para gestionar barberías, planes y acceso.
- Una app dinámica por barbería para operar el negocio desde una sola ruta.
- Un enfoque técnico orientado a minimizar lecturas de Firestore y cuidar el plan gratuito.
- Una base preparada para evolucionar hacia métricas, crecimiento y control de negocio más avanzado.

## Stack

| Capa | Tecnología |
| --- | --- |
| Framework base | Astro 6 |
| UI interactiva | React 19 |
| Lenguaje | TypeScript 5 |
| Estilos | Tailwind CSS 4 |
| Backend serverless | Firebase |
| Base de datos | Firestore |
| Autenticación | Firebase Auth |
| Archivos | Firebase Storage |
| Despliegue | GitHub Pages |

## Principios técnicos

- **Astro para lo estático**: la landing y las secciones de marketing viven como contenido rápido, indexable y con mínimo JavaScript.
- **React para la operación**: paneles, autenticación, flujos complejos y gestión en cliente se montan donde realmente aportan valor.
- **Firebase como backend práctico**: autenticación, base de datos y storage con una sola plataforma.
- **Costo cero como restricción de arquitectura**: el proyecto está diseñado para vivir dentro del plan Spark de Firebase, evitando desperdiciar lecturas.
- **Escalabilidad sin recompilar**: la arquitectura contempla rutas dinámicas por barbería para no depender de un rebuild por cada nuevo negocio.

## Arquitectura del producto

BarberFlow está dividido en tres grandes superficies:

1. **Landing pública**
   Presenta el producto, comunica beneficios, muestra planes y convierte visitas en interés comercial.

2. **Super admin**
   Permite crear barberías, gestionar estados, asignar planes y controlar el acceso general al sistema.

3. **App por barbería**
   Resuelve la operación diaria de cada negocio: agenda, servicios, barberos, catálogo, productos y administración.

## En qué estado va

Hoy el proyecto ya tiene una base sólida y una landing pública funcional.

- Landing comercial construida en Astro.
- Integración de React lista para paneles y flujos interactivos.
- Firebase configurado para Auth, Firestore y Storage.
- Estructura inicial del super admin ya montada en el código.
- Plan de desarrollo definido por etapas para avanzar desde setup hasta operación completa de barberías.

La siguiente gran meta es consolidar el flujo del super admin, el routing dinámico por barbería y el sistema de agendamiento end-to-end.

## Decisiones de arquitectura importantes

- **Infraestructura gratuita primero**: cada lectura a Firestore importa, así que el cache con TTL y las lecturas puntuales no son una optimización opcional; son parte del diseño.
- **Sin rebuild por cada barbería**: la app está planteada para resolver barberías en cliente y permitir crecimiento sin fricción operativa.
- **Sin complejidad artificial**: se prioriza una base entendible, mantenible y útil antes que una arquitectura inflada.
- **Producto primero, adorno después**: la UI debe vender, pero también debe sostener operación real.

## Estructura del proyecto

```text
src/
  components/
    home/         # Secciones de la landing
    react/        # Componentes interactivos y paneles
  layouts/        # Layouts Astro
  lib/            # Firebase, auth, tipos y lógica de dominio
  pages/          # Rutas Astro
  styles/         # Estilos globales
scripts/          # Seeds y automatizaciones administrativas
public/           # Assets estáticos
```

## Cómo correrlo localmente

### 1. Instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

Crear un archivo `.env` con las variables públicas de Firebase:

```env
PUBLIC_FIREBASE_API_KEY=
PUBLIC_FIREBASE_AUTH_DOMAIN=
PUBLIC_FIREBASE_PROJECT_ID=
PUBLIC_FIREBASE_STORAGE_BUCKET=
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
PUBLIC_FIREBASE_APP_ID=
PUBLIC_FIREBASE_MEASUREMENT_ID=
```

### 3. Iniciar el proyecto

```bash
npm run dev
```

## Scripts disponibles

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia el entorno local de desarrollo |
| `npm run build` | Genera el sitio para producción |
| `npm run preview` | Previsualiza el build local |

## Visión

BarberFlow no quiere ser solo una app para agendar citas.

Quiere convertirse en el sistema operativo de una barbería: el lugar donde el negocio se presenta, se organiza, vende y mejora.

La apuesta es construir una herramienta con identidad de producto, con criterio técnico y con foco real en operación y rentabilidad.

## Roadmap

- Super admin completo con gestión de barberías y planes.
- Rutas dinámicas para cada barbería.
- Flujo de reserva paso a paso para clientes.
- Panel administrativo por barbería.
- Control de límites por plan y estado de suscripción.
- Optimización de lecturas, caché multicapa y métricas de negocio.

## Documento de referencia

La planeación detallada del producto y sus etapas de implementación está en `PLAN_DE_TRABAJO.md`.

## Autoría del proyecto

BarberFlow está siendo construido como una plataforma con intención clara: ayudar a barberías a verse mejor, operar mejor y crecer con más control.